/**
 * 文件同步与保存回归测试。
 *
 * 覆盖三类历史缺陷：
 * 1. file-changed 事件在切换文档的窗口期到达时，旧文件的磁盘内容被写进
 *    新激活的 Tab（"A 文档内容串写进 B 文档"的根因）；
 * 2. 未修改任何内容时（纯切换文档、窗口失焦）触发无意义写盘；
 * 3. 自动保存后 Tab 脏点不消失、切走再切回重复写盘。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import App from './App'
import { fileRead, fileWrite, getCurrentFile, setCurrentFile } from './utils/fileApi'

// Mock Tauri APIs（与 App.test.tsx 保持一致的模拟面）
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    startDragging: vi.fn(),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
  })),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('./utils/fileApi', () => ({
  fileRead: vi.fn(),
  fileWrite: vi.fn(),
  getCurrentFile: vi.fn().mockResolvedValue(null),
  markFrontendReady: vi.fn().mockResolvedValue(undefined),
  setCurrentFile: vi.fn(),
  watchCurrentFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./utils/exportApi', () => ({
  exportHtml: vi.fn(),
  exportPdf: vi.fn(),
  openExportedFile: vi.fn(),
}))

vi.mock('./utils/folderApi', () => ({
  scanFolder: vi.fn().mockResolvedValue([]),
}))

describe('App 文件同步与保存', () => {
  /** 捕获到的全部 file-changed 处理器（按注册顺序） */
  let fileChangedHandlers: Array<(event: { payload: string }) => void>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    fileChangedHandlers = []
    vi.mocked(open).mockResolvedValue(null)
    vi.mocked(getCurrentFile).mockResolvedValue(null)
    vi.mocked(fileRead).mockResolvedValue('')
    vi.mocked(fileWrite).mockResolvedValue(undefined)

    // 记录每次注册的 file-changed 处理器，便于模拟"事件投递给某个时点的监听器"
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'file-changed') {
        fileChangedHandlers.push(handler as unknown as (event: { payload: string }) => void)
      }
      return vi.fn()
    })
  })

  /** 通过菜单打开文件，并等待预览区出现指定内容（打开流程完成） */
  const openFileViaMenu = async (expectedText: string) => {
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件' }))
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent(expectedText)
    )
  }

  it('file-changed 读取在途时切换文档，不得把旧文件内容写入新文档', async () => {
    const pathA = 'C:\\docs\\alpha.md'
    const pathB = 'C:\\docs\\beta.md'
    vi.mocked(open).mockResolvedValueOnce(pathA).mockResolvedValueOnce(pathB)
    vi.mocked(fileRead).mockImplementation(async (filePath) =>
      filePath === pathA ? '# Alpha 文档' : '# Beta 文档'
    )

    render(<App />)
    await openFileViaMenu('Alpha 文档')
    await openFileViaMenu('Beta 文档')

    // 切回 A，使监听器针对 A 注册
    fireEvent.click(screen.getAllByRole('tab')[0])
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('Alpha 文档')
    )

    // 拦截事件处理器内部的 fileRead 并保持挂起，制造"读取在途期间用户切换文档"的窗口
    let resolveExternalRead!: (content: string) => void
    const pendingRead = new Promise<string>((resolve) => {
      resolveExternalRead = resolve
    })
    vi.mocked(fileRead).mockImplementationOnce(() => pendingRead)

    const handlerForA = fileChangedHandlers[fileChangedHandlers.length - 1]
    expect(handlerForA).toBeTruthy()
    handlerForA?.({ payload: pathA })

    // fileRead 挂起期间切换到 B —— 全局状态已同步指向 B
    fireEvent.click(screen.getAllByRole('tab')[1])
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('Beta 文档')
    )

    // 旧文件的磁盘读取此刻才返回（修复点：await 之后必须重新校验并取消刷新）
    resolveExternalRead('# Alpha 外部修改')
    await new Promise((resolve) => window.setTimeout(resolve, 50))

    // B 的内容不得被 A 的外部内容污染，也不得触发写盘
    expect(screen.getByTestId('preview-container')).toHaveTextContent('Beta 文档')
    expect(screen.getByTestId('preview-container')).not.toHaveTextContent('外部修改')
    expect(fileWrite).not.toHaveBeenCalled()

    // A 的 Tab 保留原内容（刷新被取消，而不是写进别的 Tab）
    fireEvent.click(screen.getAllByRole('tab')[0])
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('Alpha 文档')
    )
    expect(screen.getByTestId('preview-container')).not.toHaveTextContent('外部修改')
    expect(fileWrite).not.toHaveBeenCalled()
  })

  it('未修改内容时切换文档与窗口失焦都不得触发写盘', async () => {
    const pathA = 'C:\\docs\\alpha.md'
    const pathB = 'C:\\docs\\beta.md'
    vi.mocked(open).mockResolvedValueOnce(pathA).mockResolvedValueOnce(pathB)
    vi.mocked(fileRead).mockImplementation(async (filePath) =>
      filePath === pathA ? '# Alpha 文档' : '# Beta 文档'
    )

    render(<App />)
    await openFileViaMenu('Alpha 文档')
    await openFileViaMenu('Beta 文档')

    // 反复切换文档（跨过自动保存防抖窗口），并模拟窗口失焦
    const tabs = screen.getAllByRole('tab')
    fireEvent.click(tabs[0])
    fireEvent.click(tabs[1])
    fireEvent.click(tabs[0])
    fireEvent.click(tabs[1])
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    fireEvent(document, new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })

    await new Promise((resolve) => window.setTimeout(resolve, 700))

    expect(fileWrite).not.toHaveBeenCalled()
  })

  it('仅在真实修改后自动保存一次，保存后脏点消失且切回不重写', async () => {
    const pathA = 'C:\\docs\\alpha.md'
    const pathB = 'C:\\docs\\beta.md'
    vi.mocked(open).mockResolvedValueOnce(pathA).mockResolvedValueOnce(pathB)
    vi.mocked(fileRead).mockImplementation(async (filePath) =>
      filePath === pathA ? '# Alpha 文档' : '# Beta 文档'
    )
    const user = userEvent.setup()

    render(<App />)
    await openFileViaMenu('Alpha 文档')

    // 切到编辑模式并输入内容，脏点出现
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    const editorElement = screen.getByTestId('editor-container').querySelector('.cm-content')
    await user.click(editorElement!)
    await user.keyboard(' 新增内容')
    await waitFor(() => expect(document.querySelector('.document-tab-dirty')).toBeInTheDocument())

    // 500ms 防抖后自动保存，且只保存一次。
    // 注：happy-dom 对 CodeMirror 的输入模拟会打乱字符顺序，
    // 因此只断言内容相对原文件发生了变化（与 App.close.test.tsx 的做法一致）
    await waitFor(() => expect(fileWrite).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(fileWrite).toHaveBeenCalledWith(pathA, expect.any(String))
    expect(fileWrite.mock.calls[0][1]).not.toBe('# Alpha 文档')

    // 保存成功后脏点消失（Tab 同步标记已回写）
    await waitFor(() =>
      expect(document.querySelector('.document-tab-dirty')).not.toBeInTheDocument()
    )

    // 打开 B 再切回 A：内容未再变化，不得重复写盘
    await openFileViaMenu('Beta 文档')
    fireEvent.click(screen.getAllByRole('tab')[0])
    await waitFor(() =>
      expect(screen.getByTestId('editor-container')).toHaveTextContent('Alpha 文档')
    )
    await new Promise((resolve) => window.setTimeout(resolve, 700))
    expect(fileWrite).toHaveBeenCalledTimes(1)
  })

  it('激活文档干净时的外部变更事件仍应正常刷新内容', async () => {
    const pathA = 'C:\\docs\\alpha.md'
    vi.mocked(open).mockResolvedValueOnce(pathA)
    vi.mocked(fileRead).mockResolvedValue('# Alpha 文档')

    render(<App />)
    await openFileViaMenu('Alpha 文档')

    vi.mocked(fileRead).mockResolvedValueOnce('# Alpha 外部刷新')
    fileChangedHandlers[fileChangedHandlers.length - 1]?.({ payload: pathA })

    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('外部刷新')
    )
    // 外部同步刷新不应触发写盘
    expect(fileWrite).not.toHaveBeenCalled()
  })

  it('再次打开已打开的文件应直接切换而不重新读取磁盘', async () => {
    const pathA = 'C:\\docs\\alpha.md'
    const pathB = 'C:\\docs\\beta.md'
    vi.mocked(open)
      .mockResolvedValueOnce(pathA)
      .mockResolvedValueOnce(pathB)
      .mockResolvedValueOnce(pathA)
    vi.mocked(fileRead).mockImplementation(async (filePath) =>
      filePath === pathA ? '# Alpha 文档' : '# Beta 文档'
    )

    render(<App />)
    await openFileViaMenu('Alpha 文档')
    await openFileViaMenu('Beta 文档')
    expect(fileRead).toHaveBeenCalledTimes(2)

    // 第三次打开 A：命中已有 Tab 直接切换，不触发新的磁盘读取
    //（旧实现每次点击文件树都会整文件重读，结果却被丢弃）
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件' }))
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('Alpha 文档')
    )

    expect(fileRead).toHaveBeenCalledTimes(2)
    // Rust 端当前文件状态仍被同步（驱动 watcher 重新瞄准）
    expect(setCurrentFile).toHaveBeenCalledWith(pathA)
  })
})
