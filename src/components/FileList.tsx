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
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 文件夹图标（琥珀黄简笔线条风格，20px 网格绘制）。
 * 2px 圆头描边勾勒经典文件夹轮廓；横向/纵向线段中心全部落在
 * 奇数整数坐标上（2px 描边恰好覆盖整数像素区间），小尺寸下边缘锐利。
 */
function FolderIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="#F5A623"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 16V6a2 2 0 0 1 2-2h3.5l2 2H15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/**
 * Markdown 文档图标（蓝色简笔线条风格，20px 网格绘制）。
 * 2px 圆头描边勾勒带右上折角的纸面与两根内容行；
 * 横向/纵向线段中心落在奇数整数坐标上，保证小尺寸下清晰不发虚。
 */
function DocumentIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="#3D82F5"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h5l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M11 3v4h4" />
      <path d="M7.5 12h5M7.5 15h3.5" />
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
