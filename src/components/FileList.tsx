import { useState } from 'react'
import type { FileInfo } from '../utils/folderApi'
import './FileList.css'

interface FileListProps {
  folders: FolderGroup[]
  currentFile: string | null
  onFileSelect: (filePath: string) => void
  onFolderClose?: (folderPath: string) => void
}

export interface FolderGroup {
  name: string
  path: string
  files: FileInfo[]
}

interface FileItemProps {
  file: FileInfo
  currentFile: string | null
  onFileSelect: (filePath: string) => void
  level: number
}

/**
 * 展开指示箭头（灰色简笔线条）。
 * 折叠时朝右，展开时由 CSS 旋转 90° 朝下，状态转换带 0.12s 过渡。
 */
function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M4 2.5 8 6 4 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 文件夹图标（琥珀黄双色简笔风格）。
 * 后页签用深一档的琥珀色，正面用亮琥珀色，纯色块无线条，
 * 在浅色与深色主题背景上均有足够对比度。
 */
function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="#E8A23C"
        d="M1.75 3.5A1.75 1.75 0 0 1 3.5 1.75h2.6c.5 0 .97.2 1.32.55L8.6 3.5h3.9a1.75 1.75 0 0 1 1.75 1.75v1H1.75Z"
      />
      <path
        fill="#F7C050"
        d="M1.75 6h12.5A1.75 1.75 0 0 1 16 7.75v4.5A1.75 1.75 0 0 1 14.25 14H3.5a1.75 1.75 0 0 1-1.75-1.75Z"
      />
    </svg>
  )
}

/**
 * Markdown 文档图标（蓝色系简笔风格）。
 * 浅蓝纸面 + 蓝色描边与右下折角，配两根浅色内容行，
 * 与琥珀黄文件夹形成强色彩对比，便于在树中一眼区分文件与目录。
 */
function DocumentIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="#E6F0FF"
        stroke="#4F8DF7"
        strokeWidth="1.1"
        d="M3.4 1.9h5.7l3.3 3.3v7.9a1.8 1.8 0 0 1-1.8 1.8H3.4a1.8 1.8 0 0 1-1.8-1.8V3.7a1.8 1.8 0 0 1 1.8-1.8Z"
      />
      <path fill="#4F8DF7" d="M9.2 1.9v3.3h3.2z" />
      <path
        fill="none"
        stroke="#93BAFB"
        strokeWidth="1.2"
        strokeLinecap="round"
        d="M4.6 8.4h6M4.6 11h4.2"
      />
    </svg>
  )
}

/** 文件夹关闭按钮的简笔叉号（替换原文本 x，保证粗细与圆角一致） */
function CloseIcon() {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function FileItem({ file, currentFile, onFileSelect, level }: FileItemProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const handleClick = () => {
    if (file.is_dir) {
      setIsExpanded(!isExpanded)
    } else {
      onFileSelect(file.path)
    }
  }

  const isActive = currentFile === file.path

  return (
    <div className="file-item">
      <div
        className={`file-item-header ${file.is_dir ? 'is-dir' : 'is-file'} ${
          isActive ? 'active' : ''
        }`}
        style={{ paddingLeft: `${8 + level * 14}px` }}
        onClick={handleClick}
        title={file.path}
      >
        {/* 目录行渲染展开箭头；文件行保留等宽占位，保证同层级的彩色图标纵向对齐 */}
        <span className={`tree-chevron ${file.is_dir && isExpanded ? 'is-expanded' : ''}`}>
          {file.is_dir && <ChevronIcon />}
        </span>
        <span className={`tree-icon ${file.is_dir && isExpanded ? 'is-open' : ''}`}>
          {file.is_dir ? <FolderIcon /> : <DocumentIcon />}
        </span>
        <span className="file-name">{file.name}</span>
      </div>
      {file.is_dir && isExpanded && file.children && (
        <div className="file-children">
          {file.children.map((child) => (
            <FileItem
              key={child.path}
              file={child}
              currentFile={currentFile}
              onFileSelect={onFileSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FolderItemProps {
  folder: FolderGroup
  currentFile: string | null
  onFileSelect: (filePath: string) => void
  onFolderClose?: (folderPath: string) => void
}

function FolderItem({ folder, currentFile, onFileSelect, onFolderClose }: FolderItemProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="folder-section">
      <div
        className="file-item-header is-dir folder-root"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        title={folder.path}
      >
        <span className={`tree-chevron ${isExpanded ? 'is-expanded' : ''}`}>
          <ChevronIcon />
        </span>
        <span className={`tree-icon ${isExpanded ? 'is-open' : ''}`}>
          <FolderIcon />
        </span>
        <span className="file-name">{folder.name}</span>
        {onFolderClose && (
          <button
            type="button"
            className="folder-close-button"
            onClick={(event) => {
              event.stopPropagation()
              onFolderClose(folder.path)
            }}
            title="关闭文件夹"
            aria-label={`关闭文件夹 ${folder.name}`}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="file-children">
          {folder.files.length > 0 ? (
            folder.files.map((file) => (
              <FileItem
                key={file.path}
                file={file}
                currentFile={currentFile}
                onFileSelect={onFileSelect}
                level={1}
              />
            ))
          ) : (
            <div className="folder-empty">没有 Markdown 文件</div>
          )}
        </div>
      )}
    </div>
  )
}

export function FileList({ folders, currentFile, onFileSelect, onFolderClose }: FileListProps) {
  if (folders.length === 0) {
    return (
      <div className="file-list-empty">
        <p>没有找到 Markdown 文件</p>
        <p className="hint">使用“打开文件夹”选择一个文件夹</p>
      </div>
    )
  }

  return (
    <div className="file-list" data-testid="file-list">
      {folders.map((folder) => (
        <FolderItem
          key={folder.path}
          folder={folder}
          currentFile={currentFile}
          onFileSelect={onFileSelect}
          onFolderClose={onFolderClose}
        />
      ))}
    </div>
  )
}
