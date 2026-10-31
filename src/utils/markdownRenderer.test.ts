import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readImageAsDataUrl } from './imageApi'
import {
  hydrateLocalImages,
  renderMermaidDiagrams,
  renderMarkdownToExportHtml,
  renderMarkdownToHtml,
  renderMarkdownToHtmlWithEmbeddedImages,
  resolveLocalImagePath,
} from './markdownRenderer'

vi.mock('./imageApi', () => ({
  readImageAsDataUrl: vi.fn(),
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg data-testid="rendered-mermaid"><rect fill="#ff8800" stroke="#0088ff"></rect><text style="color:#ffffff;fill:#ffffff">Flow</text></svg>',
      bindFunctions: vi.fn(),
    })),
  },
}))

describe('markdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应该识别 Typora 风格的 Windows 本地图片路径', () => {
    const content =
      '![image-20260706010200965](C:\\\\Users\\\\Lenovo\\\\AppData\\\\Roaming\\\\Typora\\\\typora-user-images\\\\image-20260706010200965.png)'
    const html = renderMarkdownToHtml(content)
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const image = wrapper.querySelector('img')

    expect(image).not.toBeNull()
    expect(image).toHaveAttribute(
      'data-local-src',
      'C:\\Users\\Lenovo\\AppData\\Roaming\\Typora\\typora-user-images\\image-20260706010200965.png'
    )
  })

  it('应该接受 file URL 图片路径', () => {
    const content =
      '![image](file:///C:/Users/Lenovo/AppData/Roaming/Typora/typora-user-images/image.png)'
    const html = renderMarkdownToHtml(content)
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const image = wrapper.querySelector('img')

    expect(image).not.toBeNull()
    expect(image).toHaveAttribute(
      'data-local-src',
      'C:\\Users\\Lenovo\\AppData\\Roaming\\Typora\\typora-user-images\\image.png'
    )
  })

  it('应该按当前 Markdown 文件位置解析相对图片路径', () => {
    const path = resolveLocalImagePath('./assets/diagram.png', 'D:\\notes\\draft.md')

    expect(path).toBe('D:\\notes\\assets\\diagram.png')
  })

  it('应该保留远程图片地址', () => {
    const html = renderMarkdownToHtml('![remote](https://example.com/image.png)')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const image = wrapper.querySelector('img')

    expect(image).toHaveAttribute('src', 'https://example.com/image.png')
    expect(image).not.toHaveAttribute('data-local-src')
  })

  it('应该正确渲染脚注，而不是生成指向脚注正文的普通链接', () => {
    const html = renderMarkdownToHtml('正文引用了脚注[^1]。\n\n[^1]: 第一条脚注')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const reference = wrapper.querySelector('.footnote-ref a')
    const item = wrapper.querySelector('.footnote-item')

    expect(reference).toHaveAttribute('href', '#fn1')
    expect(item).toHaveTextContent('第一条脚注')
    expect(wrapper.querySelector('.footnotes')).not.toBeNull()
    expect(wrapper.querySelector('a[href="%E7%AC%AC%E4%B8%80%E6%9D%A1%E8%84%9A%E6%B3%A8"]')).toBeNull()
  })

  it('预览中的任务复选框应该是只读的', () => {
    const html = renderMarkdownToHtml('- [x] 已完成\n- [ ] 未完成')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const checkboxes = wrapper.querySelectorAll<HTMLInputElement>('.task-list-item-checkbox')

    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
    checkboxes.forEach((checkbox) => expect(checkbox).toBeDisabled())
  })

  it('should escape raw HTML from Markdown content', () => {
    const html = renderMarkdownToHtml('<script>alert("xss")</script><img src=x onerror=alert(1)>')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html

    expect(wrapper.querySelector('script')).toBeNull()
    expect(wrapper.querySelector('img')).toBeNull()
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
  })

  it('应该把 Markdown 本地图片替换为 data URL', async () => {
    vi.mocked(readImageAsDataUrl).mockResolvedValue('data:image/png;base64,abc')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderMarkdownToHtml('![image](C:\\\\Users\\\\Lenovo\\\\image.png)')

    await hydrateLocalImages(wrapper)

    const image = wrapper.querySelector('img')
    expect(readImageAsDataUrl).toHaveBeenCalledWith('C:\\Users\\Lenovo\\image.png')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,abc')
    expect(image).not.toHaveAttribute('data-local-src')
  })

  it('应该处理 HTML img 标签中的本地图片路径', async () => {
    vi.mocked(readImageAsDataUrl).mockResolvedValue('data:image/png;base64,html')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<img src="C:\\Users\\Lenovo\\html-image.png" alt="html">'

    await hydrateLocalImages(wrapper)

    const image = wrapper.querySelector('img')
    expect(readImageAsDataUrl).toHaveBeenCalledWith('C:\\Users\\Lenovo\\html-image.png')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,html')
  })

  it('应该为导出 HTML 嵌入本地图片 data URL', async () => {
    vi.mocked(readImageAsDataUrl).mockResolvedValue('data:image/png;base64,export')

    const html = await renderMarkdownToHtmlWithEmbeddedImages('![image](./images/export.png)', {
      currentFile: 'D:\\notes\\draft.md',
    })

    expect(readImageAsDataUrl).toHaveBeenCalledWith('D:\\notes\\images\\export.png')
    expect(html).toContain('data:image/png;base64,export')
    expect(html).not.toContain('data-local-src')
  })

  it('should render Mermaid diagrams before exporting HTML', async () => {
    const html = await renderMarkdownToExportHtml(
      ['```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n')
    )

    expect(html).toContain('data-testid="rendered-mermaid"')
    expect(html).toContain('fill="#ff8800"')
    expect(html).toContain('color:#ffffff')
    expect(html).not.toContain('flowchart TD')
  })

  it('should initialize Mermaid in strict security mode', async () => {
    const mermaidModule = await import('mermaid')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderMarkdownToHtml(
      ['```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n')
    )

    await renderMermaidDiagrams(wrapper)

    expect(mermaidModule.default.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict' })
    )
  })

  it('单个 Mermaid 图表失败时应该显示错误并继续渲染其他图表', async () => {
    const mermaidModule = await import('mermaid')
    vi.mocked(mermaidModule.default.render)
      .mockRejectedValueOnce(new Error('Parse error on line 2'))
      .mockResolvedValueOnce({
        svg: '<svg data-testid="second-diagram"></svg>',
        bindFunctions: vi.fn(),
      })
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderMarkdownToHtml(
      [
        '```mermaid',
        'not a valid graph',
        '```',
        '',
        '```mermaid',
        'flowchart TD',
        '  A --> B',
        '```',
      ].join('\n')
    )

    await expect(renderMermaidDiagrams(wrapper)).resolves.toBeUndefined()

    const diagrams = wrapper.querySelectorAll<HTMLElement>('.mermaid')
    expect(diagrams[0]).toHaveAttribute('data-mermaid-error', 'true')
    expect(diagrams[0].querySelector('.mermaid-error-title')).toHaveTextContent(
      'Mermaid 图表渲染失败'
    )
    expect(diagrams[0].querySelector('.mermaid-error-message')).toHaveTextContent(
      'Parse error on line 2'
    )
    expect(diagrams[0].querySelector('.mermaid-error-source')).toHaveTextContent(
      'not a valid graph'
    )
    expect(diagrams[1].querySelector('[data-testid="second-diagram"]')).not.toBeNull()
  })
})

describe('代码块语法高亮', () => {
  it('已知语言应生成 highlight.js token span', () => {
    const html = renderMarkdownToHtml(['```ts', 'const answer: number = 42', '```'].join('\n'))

    expect(html).toContain('language-ts')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-number')
  })

  it('代码中的 HTML 应被转义而非注入', () => {
    const html = renderMarkdownToHtml(['```html', '<div class="evil">&</div>', '```'].join('\n'))

    // 高亮输出必须经过转义：不允许出现未转义的原始标签
    expect(html).not.toContain('<div class="evil">')
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
  })

  it('未注册语言应回退为纯文本并保留 language 类名', () => {
    const html = renderMarkdownToHtml(['```notalang', 'const answer = 42', '```'].join('\n'))

    expect(html).toContain('language-notalang')
    expect(html).not.toContain('hljs-')
    // 回退路径由 markdown-it 默认转义，内容仍应安全呈现
    expect(html).toContain('const answer = 42')
  })

  it('语言别名应正常映射高亮', () => {
    const html = renderMarkdownToHtml(['```py', 'print("hi")', '```'].join('\n'))

    expect(html).toContain('language-py')
    expect(html).toContain('hljs-')
  })

  it('mermaid 代码块不走语法高亮分支', () => {
    const html = renderMarkdownToHtml(['```mermaid', 'graph TD; A-->B;', '```'].join('\n'))

    expect(html).toContain('class="mermaid"')
    expect(html).toContain('title="双击放大查看"')
    expect(html).not.toContain('hljs-')
  })

  it('行内代码不参与语法高亮', () => {
    const html = renderMarkdownToHtml('`const answer = 42`')

    expect(html).not.toContain('hljs-')
  })

  it('导出 HTML 应携带高亮标记', async () => {
    const html = await renderMarkdownToExportHtml(['```ts', 'const answer = 42', '```'].join('\n'))

    expect(html).toContain('hljs-keyword')
  })
})
