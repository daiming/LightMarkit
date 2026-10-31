import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import App from './App'
import { scanFolder } from './utils/folderApi'
import { openExportedFile } from './utils/exportApi'
import { fileRead, fileWrite, getCurrentFile, markFrontendReady, setCurrentFile } from './utils/fileApi'
import packageInfo from '../package.json'

// Mock Tauri APIs
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
  check: vi.fn(),
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
  scanFolder: vi.fn(),
}))

describe('App', () => {
  const mockWindow = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    startDragging: vi.fn(),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(open).mockResolvedValue(null)
    vi.mocked(save).mockResolvedValue(null)
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(getCurrentFile).mockResolvedValue(null)
    vi.mocked(markFrontendReady).mockResolvedValue(undefined)
    vi.mocked(fileRead).mockResolvedValue('')
    vi.mocked(check).mockResolvedValue(null)
    vi.mocked(relaunch).mockResolvedValue(undefined)
    vi.mocked(openExportedFile).mockResolvedValue(undefined)
    vi.mocked(revealItemInDir).mockResolvedValue(undefined)
    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(getCurrentWindow).mockReturnValue(
      mockWindow as unknown as ReturnType<typeof getCurrentWindow>
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('不应该在顶部栏渲染应用标题', () => {
    render(<App />)
    expect(screen.queryByRole('heading', { name: 'LightMarkit' })).not.toBeInTheDocument()
  })

  it('不应该在顶部栏渲染应用副标题', () => {
    render(<App />)
    expect(screen.queryByText('轻量级 Markdown 编辑器')).not.toBeInTheDocument()
  })

  it('应该渲染编辑器组件', () => {
    render(<App />)
    expect(screen.getByTestId('editor-container')).toBeInTheDocument()
  })

  it('应该默认打开空白文档', () => {
    render(<App />)
    const container = screen.getByTestId('editor-container')
    expect(container.textContent).not.toContain('Welcome to LightMarkit')
  })

  it('switches to another open tab when its tab is clicked', async () => {
    vi.mocked(open).mockResolvedValueOnce('C:\\notes\\first.md').mockResolvedValueOnce('C:\\notes\\second.md')
    vi.mocked(fileRead).mockImplementation(async (filePath) =>
      filePath.includes('first') ? '# First document' : '# Second document'
    )

    render(<App />)

    const openFile = async (expectedContent: string) => {
      fireEvent.click(document.querySelector('.menu-trigger') as HTMLElement)
      fireEvent.click(screen.getByRole('menuitem', { name: '打开文件' }))
      // 打开文件默认进入预览模式，先断言预览再切回编辑断言编辑器内容
      await waitFor(() =>
        expect(screen.getByTestId('preview-container')).toHaveTextContent(expectedContent)
      )
      fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
      await waitFor(() =>
        expect(screen.getByTestId('editor-container')).toHaveTextContent(expectedContent)
      )
    }

    await openFile('First document')
    await openFile('Second document')

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByTestId('editor-container')).toHaveTextContent('Second document')
    expect(document.querySelectorAll('.tab-view-panel.active')).toHaveLength(1)
    expect(document.querySelectorAll('.tab-view-panel:not(.active)')).toHaveLength(1)

    fireEvent.click(tabs[0])

    await waitFor(() => {
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('editor-container')).toHaveTextContent('First document')
    })
  })

  it('应该在启动时加载当前文件内容', async () => {
    vi.mocked(getCurrentFile).mockResolvedValue('C:\\notes\\from-shell.md')
    vi.mocked(fileRead).mockResolvedValue('# From Shell')

    render(<App />)

    // 打开文件默认进入预览模式
    await waitFor(() => {
      expect(fileRead).toHaveBeenCalledWith('C:\\notes\\from-shell.md')
      expect(screen.getByTestId('preview-container').textContent).toContain('From Shell')
    })

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('editor-container').textContent).toContain('From Shell')
    })
  })

  it('打开文件失败时应该显示错误提示', async () => {
    vi.mocked(open).mockResolvedValue('C:\\notes\\legacy.md')
    vi.mocked(fileRead).mockRejectedValueOnce('Failed to decode UTF-8 file')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法打开文件')
    expect(alert).toHaveTextContent('Failed to decode UTF-8 file')
  })

  it('应该移除顶部视图模式切换按钮', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '预览' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '分屏' })).not.toBeInTheDocument()
  })

  it('应该通过独立设置页在铺满和默认阅读宽度之间切换', () => {
    render(<App />)

    expect(screen.getByTestId('editor-container')).toHaveClass('full-width-editor')
    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.queryByTestId('editor-container')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑' })).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('heading', { name: '编辑' }).closest('.settings-detail')
    ).not.toBeNull()
    expect(screen.queryByRole('heading', { name: '关于 LightMarkit' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /铺满/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /默认阅读宽度/ }))
    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(screen.getByTestId('editor-container')).not.toHaveClass('full-width-editor')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('preview-container')).not.toHaveClass('full-width-preview')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: /铺满/ }))
    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(screen.getByTestId('editor-container')).toHaveClass('full-width-editor')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('preview-container')).toHaveClass('full-width-preview')
  })

  it('应该同步调整并保存编辑器与预览的字体字号', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(screen.getByRole('heading', { name: '字体与字号' })).toBeInTheDocument()
    const contentFont = screen.getByRole('combobox', { name: '编辑与预览字体' })
    const contentSize = screen.getByRole('slider', { name: '编辑与预览字号' })

    expect(contentFont).toHaveValue('system')
    expect(contentSize).toHaveValue('16')
    expect(screen.getByText('Ctrl++')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+-')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+0')).toBeInTheDocument()

    fireEvent.change(contentFont, { target: { value: 'serif' } })
    fireEvent.change(contentSize, { target: { value: '20' } })

    const stored = JSON.parse(localStorage.getItem('lightmarkit.app-state.v1') ?? '{}') as {
      typography?: Record<string, unknown>
    }
    expect(stored.typography).toEqual({
      fontFamily: 'serif',
      fontSize: 20,
    })

    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    const contentArea = document.querySelector('.main-content') as HTMLElement
    expect(contentArea.style.getPropertyValue('--content-font-family')).toContain('Noto Serif SC')
    expect(contentArea.style.getPropertyValue('--content-font-size')).toBe('20px')

    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false)
    expect(contentArea.style.getPropertyValue('--content-font-size')).toBe('21px')
    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false)
    expect(contentArea.style.getPropertyValue('--content-font-size')).toBe('20px')

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('preview-container')).toBeInTheDocument()
    expect(contentArea.style.getPropertyValue('--content-font-size')).toBe('20px')

    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true })).toBe(false)
    expect(contentArea.style.getPropertyValue('--content-font-size')).toBe('16px')
  })

  it('应该忽略旧版宽度字段并默认使用铺满模式', () => {
    localStorage.setItem('lightmarkit.app-state.v1', JSON.stringify({ isEditorFullWidth: false }))

    render(<App />)

    expect(screen.getByTestId('editor-container')).toHaveClass('full-width-editor')
  })

  it('应该始终显示大纲且不再提供显隐按钮', () => {
    render(<App />)

    expect(screen.getByLabelText('文档大纲为空')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '隐藏大纲' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示大纲' })).not.toBeInTheDocument()
  })

  it('应该按分类渲染顶部工具栏', () => {
    render(<App />)
    const menuBar = screen.getByLabelText('应用菜单')
    const fileButton = screen.getByRole('button', { name: '文件' })
    const exportButton = screen.getByRole('button', { name: '导出' })
    const settingsButton = screen.getByRole('button', { name: '设置' })
    const viewModeButton = screen.getByRole('button', { name: '切换到预览' })
    const undoButton = screen.getByRole('button', { name: '撤销' })

    expect(Array.from(menuBar.children)).toEqual([
      fileButton.closest('.toolbar-menu'),
      exportButton.closest('.toolbar-menu'),
      settingsButton,
      viewModeButton,
      undoButton,
    ])
    expect(settingsButton).toHaveTextContent('设置')
    expect(screen.queryByRole('button', { name: '关于' })).not.toBeInTheDocument()
    expect(screen.queryByText('视图')).not.toBeInTheDocument()
  })

  it('应该在设置右边提供逐步撤销按钮', async () => {
    const user = userEvent.setup()
    render(<App />)

    const undoButton = screen.getByRole('button', { name: '撤销' })
    const settingsButton = screen.getByRole('button', { name: '设置' })
    const menuBar = screen.getByLabelText('应用菜单')
    // 设置按钮之后依次是编辑/预览切换按钮和撤销按钮
    expect(settingsButton.nextElementSibling).toBe(
      screen.getByRole('button', { name: '切换到预览' })
    )
    expect(undoButton.parentElement).toBe(menuBar)
    expect(undoButton).toBeDisabled()

    const editorElement = screen
      .getByTestId('editor-container')
      .querySelector('.cm-content') as HTMLElement
    await user.click(editorElement)
    await user.keyboard('abc')

    await waitFor(() => {
      expect(undoButton).toBeEnabled()
    })

    await user.click(undoButton)

    await waitFor(() => {
      expect(screen.getByTestId('editor-container')).not.toHaveTextContent('abc')
      expect(undoButton).toBeDisabled()
    })
  })

  it('编辑时输入字符不应重置编辑器滚动位置', async () => {
    // 通过外部文件变更触发内容状态更新（与输入字符走同一条 tabs 状态更新路径），
    // 避免测试环境中 CodeMirror 自身 scrollIntoView 对 scrollTop 的干扰
    let fileChangedHandler: ((event: { payload: string }) => void) | undefined
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'file-changed') {
        fileChangedHandler = handler as unknown as typeof fileChangedHandler
      }
      return vi.fn()
    })
    const currentPath = 'C:\\notes\\scroll.md'
    vi.mocked(getCurrentFile).mockResolvedValue(currentPath)
    vi.mocked(fileRead).mockResolvedValue('# 初始内容')

    render(<App />)

    // 打开文件默认进入预览模式，切回编辑模式
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('初始内容')
    )
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })

    // 等待切换视图触发的滚动恢复回调执行完毕，再模拟用户已滚动到中部
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    const scroller = document.querySelector('.cm-scroller') as HTMLElement
    scroller.scrollTop = 120

    // 外部程序修改文件 → 内容状态更新（等价于输入字符引起的状态链路）
    vi.mocked(fileRead).mockResolvedValue('# 初始内容 已更新')
    fileChangedHandler?.({ payload: currentPath })

    await waitFor(() =>
      expect(screen.getByTestId('editor-container')).toHaveTextContent('已更新')
    )
    // 等待潜在的 requestAnimationFrame 恢复回调执行完毕
    await new Promise((resolve) => window.setTimeout(resolve, 100))

    expect(scroller.scrollTop).toBe(120)
  })

  it('应该通过 Tauri Updater 检查、下载并安装新版本', async () => {
    const [major, minor, patch] = packageInfo.version.split('.').map(Number)
    const latestVersion = `${major}.${minor}.${patch + 1}`
    const downloadAndInstall = vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent?.({ event: 'Finished' })
    })
    vi.mocked(check).mockResolvedValue({
      version: latestVersion,
      downloadAndInstall,
      close: vi.fn(),
    } as unknown as Update)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '关于' }))

    expect(screen.getByRole('heading', { name: '设置' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '关于 LightMarkit' })).toBeVisible()
    expect(screen.getByText(`版本 ${packageInfo.version}`)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '专注写作' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '轻巧高效' })).toBeInTheDocument()
    expect(screen.getByText('MIT License')).toBeInTheDocument()
    expect(screen.getByText('软件更新')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'GitHub' }))
    expect(openUrl).toHaveBeenCalledWith('https://github.com/daiming/LightMarkit')

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))

    expect(await screen.findByText(`发现新版本 v${latestVersion}`)).toBeInTheDocument()
    expect(check).toHaveBeenCalledWith({ timeout: 30_000 })

    fireEvent.click(screen.getByRole('button', { name: '下载并安装' }))

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(`下载完成，正在验证签名并安装 v${latestVersion}…`)
    ).toBeInTheDocument()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('当前版本最新时应该显示提示且不提供下载按钮', async () => {
    vi.mocked(check).mockResolvedValue(null)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))

    expect(await screen.findByText(`当前已是最新版本 v${packageInfo.version}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载并安装' })).not.toBeInTheDocument()
  })

  it('更新签名验证失败时应该停止并显示错误', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('Signature verification failed'))
    vi.mocked(check).mockResolvedValue({
      version: '99.0.0',
      downloadAndInstall,
      close: vi.fn(),
    } as unknown as Update)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    fireEvent.click(await screen.findByRole('button', { name: '下载并安装' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('更新签名验证失败，已停止安装。')
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('应该渲染自定义窗口控制按钮', () => {
    render(<App />)
    expect(screen.getByRole('group', { name: '窗口控制' })).toHaveClass('windows')
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('macOS 应该交给系统标题栏渲染原生窗口控制按钮', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    })

    render(<App />)

    expect(screen.queryByRole('group', { name: '窗口控制' })).not.toBeInTheDocument()
    expect(document.querySelector('.app-header')).toHaveClass('platform-macos')
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.getByRole('menuitem', { name: '打开文件' })).toHaveAttribute(
      'title',
      '打开文件 (⌘O)'
    )
    expect(screen.getByRole('button', { name: '撤销' })).toHaveAttribute('title', '撤销上一步 (⌘Z)')
    expect(screen.getByRole('button', { name: '切换到预览' })).toHaveAttribute(
      'title',
      '切换到预览 (⌘E)'
    )

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(
      screen.getByRole('heading', { name: '设置' }).closest('.settings-sidebar')
    ).not.toBeNull()
  })

  it('双击标题栏空白区域应触发最大化/还原，且第二次按下不再启动拖拽', () => {
    render(<App />)

    const header = document.querySelector('.app-header') as HTMLElement

    // 第一次按下：记录按压并启动窗口拖拽
    fireEvent.pointerDown(header, { button: 0, detail: 1, clientX: 300, clientY: 10 })
    expect(mockWindow.startDragging).toHaveBeenCalledTimes(1)

    // 第二次快速按下（间隔与偏移在双击阈值内）：切换最大化，不再启动拖拽
    fireEvent.pointerDown(header, { button: 0, detail: 2, clientX: 302, clientY: 12 })
    expect(mockWindow.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(mockWindow.startDragging).toHaveBeenCalledTimes(1)
  })

  it('双击标题栏上的按钮不应触发最大化', () => {
    render(<App />)

    const settingsButton = screen.getByRole('button', { name: '设置' })
    fireEvent.pointerDown(settingsButton, { button: 0, detail: 1, clientX: 100, clientY: 10 })
    fireEvent.pointerDown(settingsButton, { button: 0, detail: 2, clientX: 100, clientY: 10 })

    expect(mockWindow.toggleMaximize).not.toHaveBeenCalled()
  })

  it('macOS 应该使用 Command 触发应用级快捷键', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    })

    render(<App />)

    fireEvent.keyDown(window, { key: 'e', metaKey: true })
    expect(screen.getByTestId('preview-container')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }))

    fireEvent.keyDown(window, { key: 'o', metaKey: true, shiftKey: true })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }))

    fireEvent.keyDown(window, { key: 's', metaKey: true })
    expect(save).toHaveBeenCalled()
  })

  it('应该响应系统菜单和托盘发出的应用操作', async () => {
    let systemMenuHandler: ((event: { payload: string }) => void) | undefined
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'system-menu-action') {
        systemMenuHandler = handler as unknown as typeof systemMenuHandler
      }
      return vi.fn()
    })

    render(<App />)

    await waitFor(() => expect(systemMenuHandler).toBeDefined())
    systemMenuHandler?.({ payload: 'settings' })

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()

    systemMenuHandler?.({ payload: 'open-file' })
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }))
    })
  })

  it('应该打开 macOS 访达发送的文件', async () => {
    let openFileHandler: ((event: { payload: string }) => void) | undefined
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'open-file-requested') {
        openFileHandler = handler as unknown as typeof openFileHandler
      }
      return vi.fn()
    })
    vi.mocked(fileRead).mockResolvedValue('# From Finder')

    render(<App />)

    await waitFor(() => expect(openFileHandler).toBeDefined())
    openFileHandler?.({ payload: '/Users/test/Documents/from-finder.md' })

    // 打开文件默认进入预览模式
    await waitFor(() => {
      expect(fileRead).toHaveBeenCalledWith('/Users/test/Documents/from-finder.md')
      expect(screen.getByTestId('preview-container')).toHaveTextContent('From Finder')
    })
  })

  it('应该调用 Tauri 窗口控制 API', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    expect(mockWindow.minimize).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '最大化' }))
    expect(mockWindow.toggleMaximize).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(mockWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('应该展开文件菜单显示文件操作', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '文件' }))

    expect(screen.getByRole('menuitem', { name: '打开文件' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '打开文件夹' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '保存' })).not.toBeInTheDocument()
  })

  it('export completion provides actions for the exported file and its folder', async () => {
    vi.mocked(save).mockResolvedValue('C:\\exports\\document.pdf')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 PDF' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PDF 导出完成' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '打开文件' })).toBeVisible()
    expect(screen.getByRole('button', { name: '打开所在文件夹' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }))
    expect(openExportedFile).toHaveBeenCalledWith('C:\\exports\\document.pdf')

    vi.mocked(save).mockResolvedValue('C:\\exports\\document.pdf')
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 PDF' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PDF 导出完成' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '打开所在文件夹' }))
    expect(revealItemInDir).toHaveBeenCalledWith('C:\\exports\\document.pdf')
  })

  it('closes the settings page when opening the file or export menu', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '打开文件' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '导出 HTML' })).toBeVisible()
  })

  it('应该展开导出菜单显示导出操作', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    expect(screen.getByRole('menuitem', { name: '导出 HTML' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '导出 PDF' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '导出 Markdown' })).not.toBeInTheDocument()
  })

  it('应该为导出保存框提供默认文件名', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 HTML' }))
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: 'LightMarkit Document.html' })
    )

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 PDF' }))
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: 'LightMarkit Document.pdf' })
    )
  })

  it('临时文件 Ctrl+S 应该为保存框提供默认 Markdown 文件名', async () => {
    render(<App />)

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'LightMarkit Document.md' })
      )
    })
  })

  it('应该保留多次打开的文件夹并显示文件夹名称', async () => {
    vi.mocked(open).mockResolvedValueOnce('C:\\notes\\方案').mockResolvedValueOnce('D:\\work\\归档')
    vi.mocked(scanFolder).mockImplementation(async (folderPath) => {
      if (folderPath === 'C:\\notes\\方案') {
        return [
          {
            name: '升级技术方案.md',
            path: 'C:\\notes\\方案\\升级技术方案.md',
            is_dir: false,
          },
        ]
      }

      return [
        {
          name: '会议记录.md',
          path: 'D:\\work\\归档\\会议记录.md',
          is_dir: false,
        },
      ]
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件夹' }))

    await waitFor(() => {
      expect(screen.getByText('方案')).toBeInTheDocument()
      expect(screen.getByText('升级技术方案.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件夹' }))

    await waitFor(() => {
      expect(screen.getByText('方案')).toBeInTheDocument()
      expect(screen.getByText('归档')).toBeInTheDocument()
      expect(screen.getByText('会议记录.md')).toBeInTheDocument()
    })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: true }))
  })

  it('打开文件所在文件夹后，点击树中同一文件应切回已有 Tab 而不是新建重复 Tab', async () => {
    const folderPath = 'D:\\WorkProjects\\xizang\\gaize\\HisDemo\\docs\\整体结构设计'
    const fileA = `${folderPath}\\系统架构.md`
    const fileB = `${folderPath}\\模块设计.md`
    const sidebar = () => document.querySelector('.file-sidebar') as HTMLElement

    // 第一步：直接打开文件夹中的某个文件（对话框返回普通路径形式）
    vi.mocked(open).mockResolvedValueOnce(fileA)
    vi.mocked(fileRead).mockResolvedValue('# 系统架构内容')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /系统架构\.md/ })).toHaveAttribute('title', fileA)
    })

    // 第二步：打开该文件所在的文件夹；扫描结果必须返回与对话框一致的普通路径
    // （此前 Rust 端 canonicalize 会泄漏 `\\?\` 前缀，导致同一文件被视为两个路径）
    vi.mocked(open).mockResolvedValueOnce(folderPath)
    vi.mocked(scanFolder).mockResolvedValue([
      { name: '系统架构.md', path: fileA, is_dir: false },
      { name: '模块设计.md', path: fileB, is_dir: false },
    ])

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件夹' }))

    await waitFor(() => {
      expect(within(sidebar()).getByText('模块设计.md')).toBeInTheDocument()
    })

    // 第三步：在文件树点击另一个文件 → 新增一个 Tab
    vi.mocked(fileRead).mockResolvedValue('# 模块设计内容')
    fireEvent.click(within(sidebar()).getByText('模块设计.md'))

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2)
    })

    // 第四步：再点击最初的文件 → 应切回已有 Tab（总数不变），且该 Tab 处于选中态
    fireEvent.click(within(sidebar()).getByText('系统架构.md'))

    await waitFor(() => {
      const activeTab = screen
        .getAllByRole('tab')
        .find((tab) => tab.getAttribute('aria-selected') === 'true')
      expect(activeTab).toHaveAttribute('title', fileA)
    })
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('文件加载在途时切换 Tab，不应被在途加载抢占激活', async () => {
    const folderPath = 'D:\\docs\\多标签'
    const pathOf = (name: string) => `${folderPath}\\${name}`
    vi.mocked(open).mockResolvedValueOnce(folderPath)
    vi.mocked(scanFolder).mockResolvedValue([
      { name: 'A.md', path: pathOf('A.md'), is_dir: false },
      { name: 'B.md', path: pathOf('B.md'), is_dir: false },
      { name: 'C.md', path: pathOf('C.md'), is_dir: false },
    ])

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件夹' }))

    const sidebar = () => within(document.querySelector('.file-sidebar') as HTMLElement)
    await waitFor(() => expect(sidebar().getByText('C.md')).toBeInTheDocument())

    const activeTabTitle = () =>
      screen
        .getAllByRole('tab')
        .find((tab) => tab.getAttribute('aria-selected') === 'true')
        ?.getAttribute('title')

    // 正常打开 3 个文件，建立 3 个 Tab，当前停留在最后一个（C）
    for (const name of ['A.md', 'B.md', 'C.md']) {
      vi.mocked(fileRead).mockResolvedValue(`# ${name}`)
      fireEvent.click(sidebar().getByText(name))
      await waitFor(() => expect(activeTabTitle()).toBe(pathOf(name)))
    }
    expect(screen.getAllByRole('tab')).toHaveLength(3)

    // 再次点击树中 C：loadFile 走已有 Tab 路径，让其停在 setCurrentFile 的 IPC 等待处
    let releaseSetCurrentFile: (() => void) | undefined
    vi.mocked(setCurrentFile).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSetCurrentFile = resolve
        })
    )
    fireEvent.click(sidebar().getByText('C.md'))
    await waitFor(() => expect(releaseSetCurrentFile).toBeDefined())

    // 在途期间用户点击倒数第二个 Tab（B）：这是一次真实的切换，应立即生效
    fireEvent.click(screen.getByRole('tab', { name: /B\.md/ }))
    expect(activeTabTitle()).toBe(pathOf('B.md'))

    // 放行 IPC：在途的 loadFile(C) 恢复后不得抢占激活权，
    // 也不得把当前内容/文件偷换成 C（此前表现为点击 B 却跳到最后一个 C）
    releaseSetCurrentFile?.()

    // 等待在途加载的恢复微任务执行完毕
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(activeTabTitle()).toBe(pathOf('B.md'))
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('应该默认为纯 Markdown 源码编辑模式', () => {
    render(<App />)
    expect(screen.getByTestId('editor-container')).toHaveClass('source-editor')
    expect(screen.getByTestId('editor-container')).not.toHaveClass('wysiwyg-editor')
    expect(screen.queryByTestId('preview-container')).not.toBeInTheDocument()
  })

  it('应该在标题栏设置按钮后提供带快捷键提示的编辑预览切换入口', () => {
    render(<App />)

    const previewButton = screen.getByRole('button', { name: '切换到预览' })
    expect(previewButton).toHaveTextContent('预览')
    expect(previewButton).toHaveTextContent('Ctrl+E')
    // 切换入口应位于标题栏内（设置按钮之后）
    expect(previewButton.closest('header')).not.toBeNull()

    fireEvent.click(previewButton)

    expect(screen.getByTestId('preview-container')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '切换到编辑' })).toHaveTextContent('Ctrl+E')
  })

  it('打开 Markdown 文件后应默认进入预览模式', async () => {
    vi.mocked(open).mockResolvedValueOnce('C:\\notes\\preview-default.md')
    vi.mocked(fileRead).mockResolvedValue('# 默认预览内容')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件' }))

    await waitFor(() => {
      expect(screen.getByTestId('preview-container')).toHaveTextContent('默认预览内容')
    })
    expect(screen.queryByTestId('editor-container')).not.toBeInTheDocument()
  })

  it('应该只使用单栏并且不渲染分割条', () => {
    render(<App />)
    expect(screen.queryByTestId('resizer')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.queryByTestId('resizer')).not.toBeInTheDocument()
  })

  it('应该通过 Ctrl+E 切换视图模式', () => {
    render(<App />)

    // 初始（空白文档）为源码编辑模式
    expect(screen.getByTestId('editor-container')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-container')).not.toBeInTheDocument()

    // 第一次按 Ctrl+E 切换到预览模式
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.queryByTestId('editor-container')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-container')).toBeInTheDocument()

    // 第二次按 Ctrl+E 回到源码编辑模式
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('editor-container')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-container')).not.toBeInTheDocument()
  })

  it('编辑器聚焦时切换预览不应该插入 HTML 注释或重写文件', async () => {
    vi.mocked(getCurrentFile).mockResolvedValue('C:\\notes\\unchanged.md')
    vi.mocked(fileRead).mockResolvedValue('# 未修改')
    render(<App />)

    // 打开文件默认进入预览模式；等预览出现内容（加载流程完成）后再切回编辑模式
    await waitFor(() =>
      expect(screen.getByTestId('preview-container')).toHaveTextContent('未修改')
    )
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    vi.mocked(fileWrite).mockClear()

    const editorContent = screen
      .getByTestId('editor-container')
      .querySelector<HTMLElement>('.cm-content')
    expect(editorContent).not.toBeNull()

    // 编辑器聚焦状态下切换到预览再切回，不应插入注释或写盘
    fireEvent.keyDown(editorContent as HTMLElement, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('preview-container')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('editor-container')).toBeInTheDocument()
    expect(screen.getByTestId('editor-container')).not.toHaveTextContent('<!--')
    expect(screen.getByTestId('editor-container')).not.toHaveTextContent('-->')

    await new Promise((resolve) => window.setTimeout(resolve, 550))
    expect(fileWrite).not.toHaveBeenCalled()
  })

  it('显式保存未修改的文件时也不应该触碰磁盘', async () => {
    vi.mocked(getCurrentFile).mockResolvedValue('C:\\notes\\unchanged.md')
    vi.mocked(fileRead).mockResolvedValue('# 未修改')
    render(<App />)

    await waitFor(() => expect(screen.getByText('未修改')).toBeInTheDocument())
    vi.mocked(fileWrite).mockClear()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(fileWrite).not.toHaveBeenCalled())
  })

  it('预览模式点击大纲时应该把对应标题精确滚动到顶部', async () => {
    vi.mocked(getCurrentFile).mockResolvedValue('C:\\notes\\outline.md')
    vi.mocked(fileRead).mockResolvedValue('# 第一节\n\n正文\n\n## 第二节\n\n更多正文')
    render(<App />)

    // 打开文件默认进入预览模式，无需再切换
    await waitFor(() => expect(screen.getByRole('button', { name: '第二节' })).toBeInTheDocument())

    const scroller = await screen.findByTestId('preview-container')
    const heading = scroller.querySelector<HTMLElement>('h2[data-source-line="5"]')
    expect(heading).not.toBeNull()

    scroller.scrollTop = 120
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      bottom: 640,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(heading as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      top: 310,
      bottom: 350,
      left: 0,
      right: 600,
      width: 600,
      height: 40,
      x: 0,
      y: 310,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.click(screen.getByRole('button', { name: '第二节' }))

    expect(scroller.scrollTop).toBe(390)
  })
})
