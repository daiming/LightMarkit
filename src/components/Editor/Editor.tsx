import React, { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { createEditingExtensions } from './extensions'
import { createLivePreview } from './livePreview'
import './Editor.css'

export interface EditorProps {
  /** 初始值（非受控） */
  initialValue?: string
  /** 当前值（受控） */
  value?: string
  /** 内容变化回调 */
  onChange?: (value: string) => void
  /** 是否只读 */
  readOnly?: boolean
  /** 自定义类名 */
  className?: string
  /** 编辑器就绪时回调 */
  onReady?: (view: EditorView) => void
  /** 编辑器状态更新时回调 */
  onUpdate?: (view: EditorView) => void
  /** 启用类似 Typora 的所见即所得编辑体验 */
  wysiwyg?: boolean
  /** 当前文件路径，用于解析编辑区中的本地图片 */
  currentFile?: string | null
  testId?: string | null
}

const Editor: React.FC<EditorProps> = ({
  initialValue = '',
  value,
  onChange,
  readOnly = false,
  className = '',
  onReady,
  onUpdate,
  wysiwyg = true,
  currentFile = null,
  testId,
}) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const livePreviewCompartmentRef = useRef(new Compartment())
  // updateListener 随编辑器在挂载时创建并存活整个生命周期，其闭包会冻结挂载时的
  // props。这里通过 ref 间接引用最新回调，避免调用到过期的 onChange/onUpdate——
  // App 侧回调闭包中的 isActive 会被冻结为挂载时的值，隐藏 Tab 的编辑器一旦
  // 文档发生变化，就会把内容写进当前激活的 Tab，造成文档内容串写。
  const onChangeRef = useRef(onChange)
  const onUpdateRef = useRef(onUpdate)

  // 每次渲染后刷新回调引用（无依赖数组，保证 ref 始终指向最新一次渲染的回调）
  useEffect(() => {
    onChangeRef.current = onChange
    onUpdateRef.current = onUpdate
  })

  useEffect(() => {
    if (!editorRef.current) return

    // 创建编辑器状态
    const startState = EditorState.create({
      doc: value !== undefined ? value : initialValue,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        markdown({ codeLanguages: languages }),
        ...createEditingExtensions(),
        livePreviewCompartmentRef.current.of(wysiwyg ? createLivePreview({ currentFile }) : []),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          onUpdateRef.current?.(update.view)

          if (update.docChanged && onChangeRef.current) {
            const newValue = update.state.doc.toString()
            onChangeRef.current(newValue)
          }
        }),
      ],
    })

    // 创建编辑器视图
    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    })

    viewRef.current = view
    onReady?.(view)

    // 清理函数
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 仅在挂载时初始化，忽略 props 依赖检查

  // 处理受控模式下的 value 变化
  useEffect(() => {
    if (value !== undefined && viewRef.current) {
      const currentValue = viewRef.current.state.doc.toString()
      if (value !== currentValue) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
          annotations: Transaction.addToHistory.of(false),
        })
      }
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: livePreviewCompartmentRef.current.reconfigure(
        wysiwyg ? createLivePreview({ currentFile }) : []
      ),
    })
  }, [currentFile, wysiwyg])

  return (
    <div
      ref={editorRef}
      data-testid={testId === undefined ? 'editor-container' : testId ?? undefined}
      className={`editor-wrapper ${wysiwyg ? 'wysiwyg-editor' : 'source-editor'} ${className}`}
    />
  )
}

export default Editor
