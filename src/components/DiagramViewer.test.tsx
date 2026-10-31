import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DiagramViewer } from './DiagramViewer'

/** 构造带 viewBox 的测试用 SVG 节点，模拟 Mermaid 渲染产物 */
function createTestSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 400 300')
  return svg
}

describe('DiagramViewer', () => {
  it('应该渲染对话框并按原始尺寸承载克隆的 SVG', () => {
    render(<DiagramViewer svg={createTestSvg()} onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: '图表查看器' })).toBeInTheDocument()

    const host = document.querySelector('.diagram-viewer-svg-host') as HTMLElement
    const clonedSvg = host.querySelector('svg')

    expect(clonedSvg).not.toBeNull()
    // 克隆 SVG 填满宿主，宿主布局尺寸 = 原始 viewBox 尺寸 × 缩放倍率（初始 100%）
    expect(clonedSvg).toHaveAttribute('width', '100%')
    expect(clonedSvg).toHaveAttribute('height', '100%')
    expect(host.style.width).toBe('400px')
    expect(host.style.height).toBe('300px')
  })

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn()
    render(<DiagramViewer svg={createTestSvg()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭查看器' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按下 ESC 应调用 onClose', () => {
    const onClose = vi.fn()
    render(<DiagramViewer svg={createTestSvg()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('放大/缩小按钮应按步长更新缩放百分比，100% 按钮应恢复', () => {
    render(<DiagramViewer svg={createTestSvg()} onClose={() => {}} />)

    const scaleLabel = screen.getByTestId('diagram-viewer-scale')

    // happy-dom 中舞台尺寸为 0，初始状态回退为 100%
    expect(scaleLabel).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(scaleLabel).toHaveTextContent('120%')

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(scaleLabel).toHaveTextContent('144%')

    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(scaleLabel).toHaveTextContent('120%')

    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    expect(scaleLabel).toHaveTextContent('100%')
  })

  it('缩放应通过布局尺寸驱动 SVG（矢量高清缩放），而非 transform 拉伸', () => {
    render(<DiagramViewer svg={createTestSvg()} onClose={() => {}} />)

    const host = document.querySelector('.diagram-viewer-svg-host') as HTMLElement
    const layer = document.querySelector('.diagram-viewer-layer') as HTMLElement

    // 初始 100%：宿主 400×300，图层 transform 只含平移不含 scale
    expect(host.style.width).toBe('400px')
    expect(layer.style.transform).not.toContain('scale')

    fireEvent.click(screen.getByRole('button', { name: '放大' }))

    // 放大到 120%：宿主布局尺寸随之增大，浏览器将按新尺寸重新栅格化 SVG 保持清晰
    expect(host.style.width).toBe('480px')
    expect(host.style.height).toBe('360px')
    expect(layer.style.transform).not.toContain('scale')
  })

  it('拖拽舞台应平移图层，缩放倍率保持不变', () => {
    render(<DiagramViewer svg={createTestSvg()} onClose={() => {}} />)

    const stage = document.querySelector('.diagram-viewer-stage') as HTMLElement
    const layer = document.querySelector('.diagram-viewer-layer') as HTMLElement

    // 初始（舞台尺寸为 0 的回退状态）：无偏移、100% 缩放
    expect(layer.style.transform).toContain('translate(0px, 0px)')

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 30, clientY: 40 })
    fireEvent.pointerUp(stage, { pointerId: 1 })

    // 位移 (30-10, 40-10) 应体现在图层的 translate 上
    expect(layer.style.transform).toContain('translate(20px, 30px)')
    expect(screen.getByTestId('diagram-viewer-scale')).toHaveTextContent('100%')
  })

  it('卸载后应清理 DOM 与键盘监听', () => {
    const onClose = vi.fn()
    const { unmount } = render(<DiagramViewer svg={createTestSvg()} onClose={onClose} />)

    unmount()

    expect(document.querySelector('.diagram-viewer')).toBeNull()
    // 卸载后 ESC 不应再触发关闭回调，说明监听已移除
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })
})
