import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileList } from './FileList'
import type { FileInfo } from '../utils/folderApi'

describe('FileList', () => {
  const mockOnFileSelect = vi.fn()
  const mockOnFolderClose = vi.fn()

  const mockFiles: FileInfo[] = [
    {
      name: 'note1.md',
      path: '/test/note1.md',
      is_dir: false,
      children: undefined,
    },
    {
      name: 'note2.md',
      path: '/test/note2.md',
      is_dir: false,
      children: undefined,
    },
    {
      name: 'subdir',
      path: '/test/subdir',
      is_dir: true,
      children: [
        {
          name: 'note3.md',
          path: '/test/subdir/note3.md',
          is_dir: false,
          children: undefined,
        },
      ],
    },
  ]
  const mockFolders = [
    {
      name: 'test',
      path: '/test',
      files: mockFiles,
    },
  ]

  beforeEach(() => {
    mockOnFileSelect.mockClear()
    mockOnFolderClose.mockClear()
  })

  it('should render file list', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    expect(screen.getByText('test')).toBeInTheDocument()
    expect(screen.getByText('note1.md')).toBeInTheDocument()
    expect(screen.getByText('note2.md')).toBeInTheDocument()
    expect(screen.getByText('subdir')).toBeInTheDocument()
  })

  it('should render empty state when no files', () => {
    render(<FileList folders={[]} currentFile={null} onFileSelect={mockOnFileSelect} />)

    expect(screen.getByText('没有找到 Markdown 文件')).toBeInTheDocument()
  })

  it('should call onFileSelect when file is clicked', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    fireEvent.click(screen.getByText('note1.md'))

    expect(mockOnFileSelect).toHaveBeenCalledWith('/test/note1.md')
  })

  it('should highlight active file', () => {
    render(
      <FileList
        folders={mockFolders}
        currentFile="/test/note1.md"
        onFileSelect={mockOnFileSelect}
      />
    )

    const activeItem = screen.getByText('note1.md').parentElement
    expect(activeItem).toHaveClass('active')
  })

  it('should expand/collapse directories', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    // Initially expanded - nested file should be visible
    expect(screen.getByText('note3.md')).toBeInTheDocument()

    // Click to collapse
    fireEvent.click(screen.getByText('subdir'))
    expect(screen.queryByText('note3.md')).not.toBeInTheDocument()

    // Click to expand again
    fireEvent.click(screen.getByText('subdir'))
    expect(screen.getByText('note3.md')).toBeInTheDocument()
  })

  it('should not call onFileSelect when clicking directory', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    fireEvent.click(screen.getByText('subdir'))

    expect(mockOnFileSelect).not.toHaveBeenCalled()
  })

  it('should render nested files with correct structure', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    expect(screen.getByText('note3.md')).toBeInTheDocument()
  })

  it('should handle file selection in nested directories', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    fireEvent.click(screen.getByText('note3.md'))

    expect(mockOnFileSelect).toHaveBeenCalledWith('/test/subdir/note3.md')
  })

  it('should collapse and expand a folder root', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    expect(screen.getByText('note1.md')).toBeInTheDocument()

    fireEvent.click(screen.getByText('test'))
    expect(screen.queryByText('note1.md')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('test'))
    expect(screen.getByText('note1.md')).toBeInTheDocument()
  })

  it('should close a folder root without selecting files', () => {
    render(
      <FileList
        folders={mockFolders}
        currentFile={null}
        onFileSelect={mockOnFileSelect}
        onFolderClose={mockOnFolderClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭文件夹 test' }))

    expect(mockOnFolderClose).toHaveBeenCalledWith('/test')
    expect(mockOnFileSelect).not.toHaveBeenCalled()
  })

  it('目录行与文件行应使用不同的类型样式类', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    const dirRow = screen.getByText('subdir').closest('.file-item-header')
    const fileRow = screen.getByText('note1.md').closest('.file-item-header')

    expect(dirRow).toHaveClass('is-dir')
    expect(fileRow).toHaveClass('is-file')
  })

  it('目录与文件应渲染彩色图标与展开箭头', () => {
    const { container } = render(
      <FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />
    )

    // 每一行（含根目录、子目录、文件）都有一个 16px 彩色图标
    const icons = container.querySelectorAll('.tree-icon svg')
    // 根目录 test + note1 + note2 + subdir + note3 = 5 个
    expect(icons).toHaveLength(5)

    // 目录行有展开箭头，文件行箭头槽为空占位
    const dirRow = screen.getByText('subdir').closest('.file-item-header')
    const fileRow = screen.getByText('note1.md').closest('.file-item-header')
    expect(dirRow?.querySelector('.tree-chevron svg')).toBeInTheDocument()
    expect(fileRow?.querySelector('.tree-chevron svg')).not.toBeInTheDocument()
  })

  it('展开目录行的箭头应带展开状态类，文件行不应有', () => {
    render(<FileList folders={mockFolders} currentFile={null} onFileSelect={mockOnFileSelect} />)

    const dirHeader = screen.getByText('subdir').closest('.file-item-header')
    expect(dirHeader?.querySelector('.tree-chevron')).toHaveClass('is-expanded')

    fireEvent.click(screen.getByText('subdir'))
    expect(dirHeader?.querySelector('.tree-chevron')).not.toHaveClass('is-expanded')
  })
})
