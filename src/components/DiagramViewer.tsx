/**
 * 图表查看器（DiagramViewer）
 *
 * 用途：以全窗口弹窗方式无损放大查看 Mermaid 图表（流程图、序列图等）。
 * Mermaid 渲染产物是 SVG 矢量图，缩放天然无损，因此本组件只做
 * translate + scale 变换并克隆现有 SVG 节点，不重新渲染图表。
 *
 * 交互约定：
 * - 滚轮缩放（以鼠标位置为中心），范围 20%–800%；
 * - 按住左键拖拽平移；
 * - 工具栏：放大 / 缩小 / 适应窗口 / 100% / 关闭；
 * - 双击舞台：在「适应窗口」与「100%」之间切换；
 * - 键盘：ESC 关闭，+/- 缩放，0 适应窗口，1 恢复 100%；
 * - 双击背景或点击关闭按钮退出。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import './DiagramViewer.css'

interface DiagramViewerProps {
  /** 预览中已渲染完成的 Mermaid SVG 节点（组件内部克隆，不修改原节点） */
  svg: SVGSVGElement
  /** 关闭查看器回调 */
  onClose: () => null | void
}

/** 缩放范围与步长：20%–800%，每次缩放为当前的 1.2 倍 */
const MIN_SCALE = 0.2
const MAX_SCALE = 8
const ZOOM_STEP = 1.2
/** 适应窗口时四周保留的呼吸留白（像素） */
const FIT_PADDING = 48
/** 无法从 SVG 读取尺寸时的兜底尺寸 */
const FALLBACK_SIZE = { width: 800, height: 600 }

/** 舞台变换状态：scale 为缩放倍率，x/y 为图层左上角在舞台坐标系中的位置 */
interface DiagramTransform {
  scale: number
  x: number
  y: number
}

/** 拖拽平移过程中记录的指针状态 */
interface PointerDragState {
  pointerId: number
  startX: number
  startY: number
  /** 拖拽开始时的图层偏移，平移量在此基础上累加 */
  originX: number
  originY: number
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * 读取 SVG 的原始（未缩放）尺寸。
 * 优先使用 viewBox（Mermaid 一定输出），否则回退到 width/height 属性，
 * 都没有时使用兜底尺寸（例如测试环境中手工构造的 SVG）。
 */
function readDiagramSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute('viewBox')

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)

    if (parts.length === 4 && parts.every((value) => Number.isFinite(value)) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }

  const width = parseFloat(svg.getAttribute('width') ?? '')
  const height = parseFloat(svg.getAttribute('height') ?? '')

  return {
    width: Number.isFinite(width) && width > 0 ? width : FALLBACK_SIZE.width,
    height: Number.isFinite(height) && height > 0 ? height : FALLBACK_SIZE.height,
  }
}

export function DiagramViewer({ svg, onClose }: DiagramViewerProps) {
  const [transform, setTransform] = useState<DiagramTransform>({ scale: 1, x: 0, y: 0 })
  const dialogRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const svgHostRef = useRef<HTMLDivElement>(null)
  /** SVG 原始尺寸，挂载时读取一次即可 */
  const diagramSizeRef = useRef(FALLBACK_SIZE)
  /** 当前 transform 的同步镜像：原生事件（滚轮/指针）回调中避免闭包过期 */
  const transformRef = useRef(transform)
  /** 当前处于「适应窗口」还是用户自定义缩放状态，用于双击切换 */
  const fitModeRef = useRef(true)
  /** 拖拽中的指针状态；空闲时为 null */
  const pointerDragRef = useRef<PointerDragState | null>(null)

  // 渲染提交后同步镜像，供原生事件回调读取最新变换（渲染期间写 ref 是反模式）
  useEffect(() => {
    transformRef.current = transform
  }, [transform])

  /**
   * 将缩放倍率调整到指定值，并围绕舞台内的指定锚点保持视觉位置不变。
   * 锚点公式：newX = anchorX - (anchorX - oldX) * (newScale / oldScale)。
   */
  const zoomAtAnchor = useCallback((nextScale: number, anchorX: number, anchorY: number) => {
    const target = clampScale(nextScale)

    setTransform((prev) => {
      const ratio = target / prev.scale

      return {
        scale: target,
        x: anchorX - (anchorX - prev.x) * ratio,
        y: anchorY - (anchorY - prev.y) * ratio,
      }
    })

    if (target !== 1) {
      fitModeRef.current = false
    }
  }, [])

  /** 舞台中心点坐标（用于按钮/键盘缩放的锚点） */
  const getStageCenter = useCallback(() => {
    const stage = stageRef.current

    return {
      x: (stage?.clientWidth ?? 0) / 2,
      y: (stage?.clientHeight ?? 0) / 2,
    }
  }, [])

  /** 缩放到指定倍率（围绕舞台中心） */
  const zoomToScale = useCallback(
    (scale: number) => {
      const center = getStageCenter()
      zoomAtAnchor(scale, center.x, center.y)
    },
    [getStageCenter, zoomAtAnchor]
  )

  /** 适应窗口：按 SVG 原始尺寸与舞台尺寸计算完整可见的缩放并居中 */
  const fitToWindow = useCallback(() => {
    const stage = stageRef.current

    if (!stage) {
      return
    }

    const stageWidth = stage.clientWidth
    const stageHeight = stage.clientHeight
    const { width, height } = diagramSizeRef.current

    // 测试环境（happy-dom）中舞台尺寸可能为 0，此时退化为 100% 展示
    if (stageWidth <= 0 || stageHeight <= 0 || width <= 0 || height <= 0) {
      fitModeRef.current = true
      setTransform({ scale: 1, x: 0, y: 0 })
      return
    }

    const scale = clampScale(
      Math.min((stageWidth - FIT_PADDING * 2) / width, (stageHeight - FIT_PADDING * 2) / height)
    )

    fitModeRef.current = true
    setTransform({
      scale,
      x: (stageWidth - width * scale) / 2,
      y: (stageHeight - height * scale) / 2,
    })
  }, [])

  /**
   * 挂载时克隆 SVG 并注入舞台：
   * - 克隆节点避免污染预览中的原图；
   * - 移除 Mermaid 注入的 max-width 内联限制，允许自由放大；
   * - 克隆 SVG 的 width/height 设为 100%，实际显示尺寸由宿主 div 按缩放倍率驱动
   *   （见下方尺寸同步 effect）——SVG 会按新布局尺寸重新栅格化，保证任何倍率下
   *   都是矢量级清晰，而不是先栅格化再拉伸位图；
   * - 完成后执行首次「适应窗口」。
   */
  useEffect(() => {
    const host = svgHostRef.current

    if (!host) {
      return
    }

    const clone = svg.cloneNode(true) as SVGSVGElement
    const size = readDiagramSize(clone)

    diagramSizeRef.current = size
    clone.style.maxWidth = ''
    clone.style.maxHeight = ''
    clone.setAttribute('width', '100%')
    clone.setAttribute('height', '100%')
    host.appendChild(clone)
    fitToWindow()

    return () => {
      clone.remove()
    }
  }, [svg, fitToWindow])

  /**
   * 缩放倍率变化时同步宿主 div 的布局尺寸。
   * 这是“矢量高清缩放”的关键：浏览器按 width/height 指定的最终布局尺寸
   * 重新栅格化 SVG（文字、线条在任何倍率下都清晰锐利）；
   * 相比之下 CSS transform: scale() 只是放大已栅格化的位图，放大即模糊。
   * 平移仍用 translate 实现——平移不影响栅格化质量。
   */
  useEffect(() => {
    const host = svgHostRef.current

    if (!host) {
      return
    }

    const { width, height } = diagramSizeRef.current

    host.style.width = `${width * transform.scale}px`
    host.style.height = `${height * transform.scale}px`
  }, [transform.scale])

  /**
   * 滚轮缩放：必须用原生监听并显式 passive: false，
   * 否则无法 preventDefault()，会导致整个弹窗被浏览器滚动。
   */
  useEffect(() => {
    const stage = stageRef.current

    if (!stage) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      // 以鼠标在舞台内的位置作为缩放锚点
      const anchorX = event.clientX - rect.left
      const anchorY = event.clientY - rect.top
      const current = transformRef.current.scale
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP

      zoomAtAnchor(current * factor, anchorX, anchorY)
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      stage.removeEventListener('wheel', handleWheel)
    }
  }, [zoomAtAnchor])

  /** 键盘快捷键：查看器为模态弹窗，直接监听窗口级键盘事件即可 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key === '+' || event.key === '=') {
        zoomToScale(transformRef.current.scale * ZOOM_STEP)
        return
      }

      if (event.key === '-' || event.key === '_') {
        zoomToScale(transformRef.current.scale / ZOOM_STEP)
        return
      }

      if (event.key === '0') {
        fitToWindow()
        return
      }

      if (event.key === '1') {
        zoomToScale(1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, zoomToScale, fitToWindow])

  /** 拖拽平移开始：捕获指针，记录起点与当前图层偏移 */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const stage = stageRef.current

    if (!stage) {
      return
    }

    // 可选调用：部分环境（如测试用的 happy-dom）未实现指针捕获 API
    stage.setPointerCapture?.(event.pointerId)
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    }
  }

  /** 拖拽平移中：按指针位移更新图层偏移，缩放倍率保持不变 */
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    setTransform((prev) => ({
      ...prev,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }))
    fitModeRef.current = false
  }

  /** 拖拽结束/中断：释放指针并清理状态 */
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    pointerDragRef.current = null
    stageRef.current?.releasePointerCapture?.(event.pointerId)
  }

  /** 双击舞台（含空白区域）：适应窗口 ↔ 100% 切换；关闭请用 ESC 或关闭按钮 */
  const handleStageDoubleClick = () => {
    if (fitModeRef.current) {
      zoomToScale(1)
    } else {
      fitToWindow()
    }
  }

  return (
    <div
      ref={dialogRef}
      className="diagram-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="图表查看器"
    >
      {/* 半透明背景（纯视觉，位于最底层；舞台覆盖其上，双击交互都在舞台上） */}
      <div className="diagram-viewer-backdrop" />
      {/* 工具栏：缩放控制与关闭按钮（z-index 高于舞台保证可点击） */}
      <div className="diagram-viewer-toolbar" role="toolbar" aria-label="图表查看工具">
        <button
          type="button"
          className="diagram-viewer-button"
          aria-label="缩小"
          title="缩小"
          onClick={() => zoomToScale(transform.scale / ZOOM_STEP)}
        >
          −
        </button>
        <span className="diagram-viewer-scale" data-testid="diagram-viewer-scale">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          type="button"
          className="diagram-viewer-button"
          aria-label="放大"
          title="放大"
          onClick={() => zoomToScale(transform.scale * ZOOM_STEP)}
        >
          +
        </button>
        <button
          type="button"
          className="diagram-viewer-button diagram-viewer-button-text"
          onClick={fitToWindow}
        >
          适应窗口
        </button>
        <button
          type="button"
          className="diagram-viewer-button diagram-viewer-button-text"
          onClick={() => zoomToScale(1)}
        >
          100%
        </button>
        <button
          type="button"
          className="diagram-viewer-button diagram-viewer-close"
          aria-label="关闭查看器"
          title="关闭查看器"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {/* 舞台：滚轮缩放与拖拽平移的目标区域 */}
      <div
        ref={stageRef}
        className="diagram-viewer-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleStageDoubleClick}
      >
        {/* 图层：仅承担平移（translate）；缩放通过宿主 div 的布局尺寸实现，
            避免 transform 缩放触发“先栅格化再拉伸”的位图式模糊 */}
        <div
          className="diagram-viewer-layer"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px)` }}
        >
          <div ref={svgHostRef} className="diagram-viewer-svg-host" />
        </div>
      </div>
    </div>
  )
}
