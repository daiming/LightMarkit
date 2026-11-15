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
 * 文件夹图标（琥珀色，iconfont 提供的开/合双态造型）。
 * 折叠时显示关闭文件夹，展开时显示打开文件夹（深色盖子 + 亮色托盘），
 * 图标本身随目录开合切换，与展开箭头一起构成双重状态反馈。
 *
 * viewBox 裁剪到图形精确边界（经 getBBox 实测），消除原 1024 网格
 * 顶部约 18% 的空白——此前图形被推向下方的视觉偏移即来源于此。
 * 两个状态的图形宽高比几乎一致（约 1.214），统一按 19.4x16 渲染，
 * 开合切换时图标大小保持一致，只有造型变化。
 */
function FolderIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="3.98 186.4 1016.03 837.58" width="19.4" height="16" aria-hidden="true">
        {/* 打开状态：上半部分为掀开的盖子（深一档琥珀），下半部分为托盘 */}
        <path
          fill="#E8A23C"
          d="M302.797605 485.218594h537.919985v-59.746308a119.560354 119.560354 0 0 0-119.537775-119.537774H482.126846a119.537774 119.537774 0 0 0-119.537774-119.537775H123.513523a119.560354 119.560354 0 0 0-119.537774 119.537775v597.666292c0 15.241405 3.16118 29.692515 8.354548 43.082371l170.929533-341.904227c39.130896-59.497929 53.536846-119.560354 119.537775-119.560354z"
        />
        <path
          fill="#F5A623"
          d="M900.486477 544.987481H362.589072c-66.023508 0-80.452038 60.062425-119.537774 119.537774L63.722056 963.347111c0 66.023508 53.536846 59.768887 119.537774 59.768888h537.919985c66.000928 0 80.429458 12.75762 119.537775-59.768888l179.284081-298.821856a119.515195 119.515195 0 0 0-119.515194-119.537774z"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="2.26 184.41 1019.51 839.59" width="19.4" height="16" aria-hidden="true">
      {/* 关闭状态：经典实心文件夹（页签 + 本体），与打开态等大 */}
      <path
        fill="#F5A623"
        d="M901.797398 304.354928H482.013848a119.944609 119.944609 0 0 0-119.944609-119.944608H122.202602A119.944609 119.944609 0 0 0 2.257993 304.354928v599.700463c0 10.07065 1.625755 19.734862 3.974069 29.105535 0.587078 2.348313 1.422536 4.583727 2.099934 6.93204 2.461213 7.609438 5.509504 14.880176 9.370672 21.721896 0.699978 1.354796 1.354796 2.687012 2.122514 3.974069a120.034928 120.034928 0 0 0 42.382536 41.592238 118.883352 118.883352 0 0 0 59.994884 16.618831h779.594796a119.967189 119.967189 0 0 0 119.967189-119.944609V424.322117a120.012348 120.012348 0 0 0-119.967189-119.967189z m-779.594796 0c-17.567189 0-34.14086 3.996648-49.201676 10.770629a119.809129 119.809129 0 0 1 109.1514-70.742933h119.944609c44.25667 0 82.507078 24.250849 103.303197 59.972304H122.202602z"
      />
    </svg>
  )
}

/**
 * Markdown 文档图标（iconfont 提供的带内容行文档造型）。
 * 填充色使用 currentColor，由外层 CSS 控制：
 * 未选中与文件标题同色，选中行切换为主题蓝，强化选中反馈。
 * viewBox 同样裁剪到图形边界（顶部原有 15% 空白导致偏下），
 * 16px 高与关闭文件夹（17.3px）形成协调的大小层次。
 */
function DocumentIcon() {
  return (
    <svg viewBox="168.4 156.1 687.3 711.9" width="15.5" height="16" aria-hidden="true">
      {/* 圆角纸面轮廓 */}
      <path
        fill="currentColor"
        d="M741.3 161.6h-42.4c-10.5 0-19.1 8.6-19.1 19.1s8.6 19.1 19.1 19.1h42.4c42 0 76.2 34.2 76.2 76.3v477.4c0 42.1-34.3 76.3-76.4 76.3H282.9c-42.1 0-76.3-34.2-76.3-76.3V276.1c0-42.1 34.2-76.3 76.3-76.3h44.9c10.5 0 19.1-8.6 19.1-19.1s-8.6-19.1-19.1-19.1h-44.9c-63.1 0-114.5 51.4-114.5 114.5v477.4c0 63.1 51.4 114.5 114.5 114.5h458.3c63.1 0 114.5-51.4 114.5-114.5V276.1c-0.1-63.1-51.4-114.5-114.4-114.5z"
      />
      {/* 顶部标签与三根内容行 */}
      <path
        fill="currentColor"
        d="M680.6 505.3H343.4c-12.3 0-22.3 8.6-22.3 19.1s10 19.1 22.3 19.1h337.2c12.3 0 22.3-8.6 22.3-19.1 0-10.6-10-19.1-22.3-19.1zM439.3 213.3h144.6c19 0 34.4-12.8 34.4-28.6s-15.4-28.6-34.4-28.6H439.3c-19 0-34.4 12.8-34.4 28.6-0.1 15.7 15.3 28.6 34.4 28.6zM680.6 658H343.4c-12.3 0-22.3 8.5-22.3 19.1 0 10.5 10 19.1 22.3 19.1h337.2c12.3 0 22.3-8.6 22.3-19.1 0-10.6-10-19.1-22.3-19.1zM680.6 352.5H343.4c-12.3 0-22.3 8.6-22.3 19.1s10 19.1 22.3 19.1h337.2c12.3 0 22.3-8.6 22.3-19.1 0-10.5-10-19.1-22.3-19.1z"
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
        <span className="tree-icon">
          {file.is_dir ? <FolderIcon open={isExpanded} /> : <DocumentIcon />}
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
        <span className="tree-icon">
          <FolderIcon open={isExpanded} />
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
