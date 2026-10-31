import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  hydrateLocalImages,
  renderMarkdownToHtml,
  renderMermaidDiagrams,
} from '../utils/markdownRenderer'
import { copyTextToClipboard } from '../utils/clipboard'
import { DiagramViewer } from './DiagramViewer'
import './Preview.css'

interface PreviewProps {
  content: string
  currentFile?: string | null
  className?: string
}

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JS',
  js: 'JS',
  typescript: 'TS',
  ts: 'TS',
  python: 'PY',
  py: 'PY',
  shell: 'SH',
  bash: 'SH',
}

export function Preview({ content, currentFile = null, className = '' }: PreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null)
  const previewContentRef = useRef<HTMLDivElement>(null)
  const collapsedCodeBlocksRef = useRef<Map<string, Set<string>>>(new Map())
  // 双击 Mermaid 图表后打开的全窗口查看器所对应的 SVG 节点；null 表示查看器关闭
  const [viewingDiagram, setViewingDiagram] = useState<SVGSVGElement | null>(null)
  const renderedHtml = useMemo(
    () => renderMarkdownToHtml(content, { currentFile }),
    [content, currentFile]
  )

  useEffect(() => {
    const root = previewContentRef.current

    if (!root) {
      return
    }

    root.innerHTML = renderedHtml

    const handleExternalLinkClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const link = target.closest<HTMLAnchorElement>('a[data-external-link="true"]')
      if (!link || !root.contains(link)) return

      event.preventDefault()
      event.stopPropagation()
      void openUrl(link.href)
    }

    root.addEventListener('click', handleExternalLinkClick)

    // 双击 Mermaid 图表打开全窗口查看器（SVG 矢量缩放，无损放大）
    const handleDiagramDoubleClick = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const mermaid = target.closest<HTMLElement>('.mermaid')

      // 仅响应渲染成功（含 SVG）的图表；错误态显示的是失败信息，不触发查看器
      if (!mermaid || !root.contains(mermaid)) {
        return
      }

      const svg = mermaid.querySelector('svg')

      if (svg instanceof SVGSVGElement) {
        setViewingDiagram(svg)
      }
    }

    root.addEventListener('dblclick', handleDiagramDoubleClick)

    const documentKey = currentFile ?? '__untitled__'
    const collapsedBlockKeys = collapsedCodeBlocksRef.current.get(documentKey) ?? new Set<string>()
    const feedbackTimers: number[] = []

    root.querySelectorAll<HTMLPreElement>('pre').forEach((codeBlock, index) => {
      const codeElement = codeBlock.querySelector('code')
      const sourceLine =
        codeBlock.getAttribute('data-source-line') ?? codeElement?.getAttribute('data-source-line')
      const blockKey = sourceLine ? `line-${sourceLine}` : `index-${index}`
      const wrapper = document.createElement('div')
      const summary = document.createElement('div')
      const languageLabel = document.createElement('span')
      const firstLineLabel = document.createElement('span')
      const lineCountLabel = document.createElement('span')
      const copyButton = document.createElement('button')
      const toggle = document.createElement('button')
      const normalizedCode = (codeElement?.textContent ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n$/, '')
      const codeLines = normalizedCode ? normalizedCode.split('\n') : []
      const firstLine = codeLines.find((line) => line.trim())?.trim() ?? '空代码块'
      const languageClass = Array.from(codeElement?.classList ?? []).find((className) =>
        className.startsWith('language-')
      )
      const rawLanguage = languageClass?.slice('language-'.length).toLowerCase() ?? 'code'

      wrapper.className = 'preview-code-block'
      codeBlock.parentNode?.insertBefore(wrapper, codeBlock)
      wrapper.append(codeBlock)

      summary.className = 'preview-code-summary'
      languageLabel.className = 'preview-code-language'
      languageLabel.textContent = CODE_LANGUAGE_LABELS[rawLanguage] ?? rawLanguage.toUpperCase()
      firstLineLabel.className = 'preview-code-first-line'
      firstLineLabel.textContent = firstLine
      firstLineLabel.title = firstLine
      lineCountLabel.className = 'preview-code-line-count'
      lineCountLabel.textContent = `${codeLines.length} 行`
      summary.append(languageLabel, firstLineLabel, lineCountLabel)
      wrapper.append(summary)

      copyButton.type = 'button'
      copyButton.className = 'preview-code-copy'
      copyButton.textContent = '复制'
      copyButton.setAttribute('aria-label', '复制代码')
      copyButton.title = '复制代码'
      copyButton.addEventListener('click', () => {
        void copyTextToClipboard(normalizedCode)
          .then(() => {
            copyButton.textContent = '已复制'
            copyButton.classList.add('is-copied')
          })
          .catch(() => {
            copyButton.textContent = '复制失败'
            copyButton.classList.add('is-error')
          })
          .finally(() => {
            feedbackTimers.push(
              window.setTimeout(() => {
                copyButton.textContent = '复制'
                copyButton.classList.remove('is-copied', 'is-error')
              }, 1600)
            )
          })
      })
      wrapper.append(copyButton)

      toggle.type = 'button'
      toggle.className = 'preview-code-toggle'
      wrapper.append(toggle)

      const setCollapsed = (collapsed: boolean) => {
        codeBlock.hidden = collapsed
        summary.hidden = !collapsed
        wrapper.classList.toggle('is-collapsed', collapsed)
        toggle.setAttribute('aria-expanded', String(!collapsed))
        toggle.setAttribute('aria-label', collapsed ? '展开代码块' : '折叠代码块')
        toggle.title = collapsed ? '展开代码块' : '折叠代码块'
      }

      setCollapsed(collapsedBlockKeys.has(blockKey))

      toggle.addEventListener('click', () => {
        const collapsed = !codeBlock.hidden

        if (collapsed) {
          collapsedBlockKeys.add(blockKey)
          collapsedCodeBlocksRef.current.set(documentKey, collapsedBlockKeys)
        } else {
          collapsedBlockKeys.delete(blockKey)
        }

        setCollapsed(collapsed)
      })
    })

    void hydrateLocalImages(root, { currentFile })
    void renderMermaidDiagrams(root).catch((error) => {
      console.error('Mermaid rendering error:', error)
    })

    return () => {
      feedbackTimers.forEach((timer) => window.clearTimeout(timer))
      root.removeEventListener('click', handleExternalLinkClick)
      root.removeEventListener('dblclick', handleDiagramDoubleClick)
    }
  }, [renderedHtml, currentFile])

  return (
    <div
      ref={previewRef}
      className={`preview-container ${className}`}
      data-testid="preview-container"
    >
      <div ref={previewContentRef} className="preview-content" />
      {viewingDiagram
        ? // 通过 Portal 渲染到 document.body：查看器必须脱离预览面板的祖先层叠上下文，
          // 否则 fixed 遮罩会被 .app-header（z-index: 100）等局部层叠上下文压制，
          // 导致标题栏悬浮在遮罩之上；挂到 body 后 z-index 3000 在文档根层级生效，
          // 可完整覆盖整个窗口（含标题栏与设置页之上的层叠）
          createPortal(
            <DiagramViewer svg={viewingDiagram} onClose={() => setViewingDiagram(null)} />,
            document.body
          )
        : null}
    </div>
  )
}
