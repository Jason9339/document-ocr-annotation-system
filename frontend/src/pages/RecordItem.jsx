import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Stage,
  Layer,
  Rect,
  Image as KonvaImage,
  Text as KonvaText,
  Transformer,
  Label,
  Tag,
} from 'react-konva'
import { api } from '../lib/api.js'

const MODE_DRAW = 'draw'
const MODE_EDIT = 'edit'
const MIN_DRAW_SIZE = 12

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `ann-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function usePageImage(url) {
  const [image, setImage] = useState(null)

  useEffect(() => {
    if (!url) {
      setImage(null)
      return
    }
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload = () => {
      console.log('[DEBUG] Image loaded:', {
        url,
        width: img.width,
        height: img.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      })
      setImage(img)
    }
    img.onerror = () => {
      console.error('[DEBUG] Image load error:', url)
      setImage(null)
    }
    img.src = url
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [url])

  return image
}

function normaliseAnnotation(annotation, fallbackIndex = 0) {
  return {
    id: annotation.id || randomId(),
    text: annotation.text ?? '',
    label: annotation.label ?? 'text',
    x: Number.isFinite(annotation.x) ? annotation.x : 80 + fallbackIndex * 12,
    y: Number.isFinite(annotation.y) ? annotation.y : 80 + fallbackIndex * 12,
    width: Number.isFinite(annotation.width) ? Math.max(40, annotation.width) : 180,
    height: Number.isFinite(annotation.height) ? Math.max(40, annotation.height) : 120,
    rotation: Number.isFinite(annotation.rotation) ? annotation.rotation : 0,
    order: Number.isFinite(annotation.order) ? annotation.order : fallbackIndex,
  }
}

function serialiseAnnotations(annotations) {
  return annotations.map(({ id, text, label, x, y, width, height, rotation, order }) => ({
    id,
    text,
    label,
    x,
    y,
    width,
    height,
    rotation,
    order,
  }))
}

function AnnotationCard({
  annotation,
  isSelected,
  onSelect,
  onChange,
  onDelete,
  palette,
  onBeginTextEdit = () => {},
}) {
  return (
    <div
      className={`annotation-card${isSelected ? ' annotation-card--active' : ''}`}
      onClick={() => onSelect(annotation.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(annotation.id)
        }
      }}
      style={{ borderColor: isSelected ? palette.accent : undefined }}
    >
      <header>
        <span className="annotation-card__label">{annotation.label}</span>
        <span className="annotation-card__order">#{annotation.order + 1}</span>
      </header>
      <textarea
        className="annotation-card__textarea"
        value={annotation.text}
        onChange={(event) => onChange(annotation.id, { text: event.target.value })}
        onFocus={() => {
          onSelect(annotation.id)
          onBeginTextEdit()
        }}
        rows={1}
        placeholder="輸入文字…"
      />
      <div className="annotation-card__actions">
        <button
          type="button"
          className="ghost"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(annotation.id)
          }}
        >
          刪除
        </button>
      </div>
    </div>
  )
}

export default function RecordItemPage({
  params,
  onNavigate,
  workspaceState,
  onRefreshWorkspaces,
}) {
  const palette = useMemo(
    () => ({
      base: '#0b3d2e',
      surface: '#f4efe6',
      highlight: '#1b5e4a',
      accent: '#d4a373',
      error: '#b71c1c',
    }),
    [],
  )

  const itemId = params.id ? decodeURIComponent(params.id) : ''
  const [recordSlug, filename] = useMemo(() => {
    if (!itemId || !itemId.includes('/')) {
      return [null, null]
    }
    const [recordPart, ...rest] = itemId.split('/')
    const filePart = rest.join('/')
    return [recordPart || null, filePart || null]
  }, [itemId])
  const [mode, setMode] = useState(MODE_DRAW)
  const isDrawMode = mode === MODE_DRAW

  const [pageInfo, setPageInfo] = useState({
    loading: true,
    error: null,
    page: null,
  })
  const [annotations, setAnnotations] = useState([])
  const [annotationsReady, setAnnotationsReady] = useState(false)
  const [annotationsError, setAnnotationsError] = useState(null)
  const annotationsInitialised = useRef(false)
  const [selectedId, setSelectedId] = useState(null)
  const [saveStatus, setSaveStatus] = useState({
    state: 'idle',
    updatedAt: null,
    error: null,
  })
  const [drawingState, setDrawingState] = useState(null)

  const autosaveTimerRef = useRef(null)
  const stageContainerRef = useRef(null)
  const stageRef = useRef(null)
  const transformerRef = useRef(null)
  const shapeRefs = useRef({})
  const [containerSize, setContainerSize] = useState({ width: 960, height: 640 })

  const workspace = workspaceState.current

  const handleBackToRecords = useCallback(() => {
    onNavigate('/records')
  }, [onNavigate])

  const pageImage = usePageImage(pageInfo.page?.original_url)

  const stageSize = useMemo(() => {
    const baseWidth =
      containerSize.width && containerSize.width > 0
        ? containerSize.width
        : pageImage?.width ?? 960
    const fallbackHeight =
      containerSize.height && containerSize.height > 0
        ? containerSize.height
        : pageImage?.height ??
          (typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : 640)

    if (!pageImage) {
      return {
        width: Math.max(baseWidth, 320),
        height: Math.max(fallbackHeight, 320),
        scale: 1,
      }
    }

    const availableWidth = Math.max(baseWidth, 320)
    const availableHeight = Math.max(fallbackHeight, 320)
    const scale = Math.min(availableWidth / pageImage.width, availableHeight / pageImage.height, 1)
    const width = pageImage.width * scale
    const height = pageImage.height * scale

    console.log('[DEBUG] Stage size calculation:', {
      imageSize: { width: pageImage.width, height: pageImage.height },
      availableSize: { width: availableWidth, height: availableHeight },
      scale,
      stageSize: { width, height }
    })

    return { width, height, scale }
  }, [pageImage, containerSize])
  const stageScale = stageSize.scale || 1

  useEffect(() => {
    const handleResize = () => {
      if (!stageContainerRef.current) {
        return
      }
      setContainerSize({
        width: stageContainerRef.current.clientWidth,
        height: stageContainerRef.current.clientHeight,
      })
    }

    handleResize()
    let resizeObserver
    const supportsResizeObserver =
      typeof window !== 'undefined' && typeof window.ResizeObserver !== 'undefined'
    if (supportsResizeObserver) {
      resizeObserver = new window.ResizeObserver(handleResize)
      if (stageContainerRef.current) {
        resizeObserver.observe(stageContainerRef.current)
      }
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize)
    }
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect()
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [])

  useEffect(() => {
    if (!recordSlug || !workspace) {
      setPageInfo({
        loading: false,
        error: '請先選擇 Workspace。',
        page: null,
      })
      return
    }

    let cancelled = false
    setPageInfo({ loading: true, error: null, page: null })
    api
      .getRecord(recordSlug)
      .then((payload) => {
        if (cancelled) {
          return
        }
        const record = payload.record
        if (!record || !Array.isArray(record.pages)) {
          setPageInfo({ loading: false, error: 'Record 資料不完整。', page: null })
          return
        }
        const page = record.pages.find((entry) => entry.id === itemId)
        if (!page) {
          setPageInfo({ loading: false, error: '找不到指定的頁面。', page: null })
          return
        }
        setPageInfo({ loading: false, error: null, page })
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setPageInfo({
          loading: false,
          error: err.message ?? '無法載入頁面資料。',
          page: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [recordSlug, workspace, itemId])

  useEffect(() => {
    if (!itemId || !workspace) {
      setAnnotations([])
      setAnnotationsReady(false)
      annotationsInitialised.current = false
      setDrawingState(null)
      return
    }
    let cancelled = false
    setAnnotationsError(null)
    api
      .getItemAnnotations(itemId)
      .then((payload) => {
        if (cancelled) {
          return
        }
        console.log('[DEBUG] Annotations loaded:', {
          total: payload.annotations?.length || 0,
          first: payload.annotations?.[0]
        })
        const normalised = Array.isArray(payload.annotations)
          ? payload.annotations.map((annotation, index) =>
              normaliseAnnotation(annotation, index),
            )
          : []
        console.log('[DEBUG] Normalised annotations:', {
          total: normalised.length,
          first: normalised[0]
        })
        setDrawingState(null)
        setAnnotations(normalised)
        setAnnotationsReady(true)
        annotationsInitialised.current = true
        setSaveStatus({
          state: 'saved',
          updatedAt: payload.updated_at ?? new Date().toISOString(),
          error: null,
        })
        setSelectedId(normalised[0]?.id ?? null)
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setAnnotations([])
        setAnnotationsReady(true)
        annotationsInitialised.current = true
        setDrawingState(null)
        setAnnotationsError(err.message ?? '無法載入標註檔案。')
      })

    return () => {
      cancelled = true
    }
  }, [itemId, workspace])

  const performSave = useCallback(async () => {
    if (!annotationsReady || !itemId) {
      return
    }
    setSaveStatus((prev) => ({
      state: 'saving',
      updatedAt: prev.updatedAt,
      error: null,
    }))
    try {
      const payload = await api.updateItemAnnotations(itemId, {
        annotations: serialiseAnnotations(annotations),
      })
      setSaveStatus({
        state: 'saved',
        updatedAt: payload.updated_at ?? new Date().toISOString(),
        error: null,
      })
    } catch (error) {
      setSaveStatus({
        state: 'error',
        updatedAt: null,
        error: error.message ?? '儲存失敗，請稍後再試。',
      })
    }
  }, [annotations, annotationsReady, itemId])

  useEffect(() => {
    if (!annotationsReady) {
      return undefined
    }
    if (!annotationsInitialised.current) {
      annotationsInitialised.current = true
      return undefined
    }
    setSaveStatus((prev) => ({
      state: 'dirty',
      updatedAt: prev.updatedAt,
      error: null,
    }))
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }
    const timer = setTimeout(() => {
      autosaveTimerRef.current = null
      performSave()
    }, 1200)
    autosaveTimerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (autosaveTimerRef.current === timer) {
        autosaveTimerRef.current = null
      }
    }
  }, [annotations, annotationsReady, performSave])

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) {
      return
    }
    const node = selectedId ? shapeRefs.current[selectedId] : null
    if (node) {
      transformer.nodes([node])
      transformer.getLayer()?.batchDraw()
    } else {
      transformer.nodes([])
      transformer.getLayer()?.batchDraw()
    }
  }, [selectedId, annotations])

  const handleAddAnnotation = useCallback(() => {
    setMode(MODE_DRAW)
    const imageWidth = pageImage?.width ?? 600
    const imageHeight = pageImage?.height ?? 600
    const centerX = Math.max(20, imageWidth / 2 - 120)
    const centerY = Math.max(20, imageHeight / 2 - 90)
    const newId = randomId()
    setAnnotations((prev) => [
      ...prev,
      normaliseAnnotation(
        {
          id: newId,
          text: '',
          x: centerX,
          y: centerY,
          width: 240,
          height: 180,
          order: prev.length,
        },
        prev.length,
      ),
    ])
    setSelectedId(newId)
  }, [pageImage])

  const handleUpdateAnnotation = useCallback((id, payload) => {
    setAnnotations((prev) =>
      prev.map((annotation) => {
        if (annotation.id !== id) {
          return annotation
        }
        const next = { ...annotation, ...payload }
        if (typeof next.width === 'number') {
          next.width = Math.max(next.width, MIN_DRAW_SIZE)
        }
        if (typeof next.height === 'number') {
          next.height = Math.max(next.height, MIN_DRAW_SIZE)
        }
        return next
      }),
    )
  }, [])

  const handleDeleteAnnotation = useCallback(
    (id) => {
      let removed = false
      setAnnotations((prev) => {
        const filtered = prev.filter((annotation) => {
          const keep = annotation.id !== id
          if (!keep) {
            removed = true
          }
          return keep
        })
        return filtered.map((annotation, index) => ({
          ...annotation,
          order: index,
        }))
      })
      if (removed) {
        setSelectedId(null)
      }
    },
    [setAnnotations],
  )

  const pointerPositionToImage = useCallback(
    (stage) => {
      const pointer = stage?.getPointerPosition()
      if (!pointer) {
        return null
      }
      return {
        x: pointer.x / stageScale,
        y: pointer.y / stageScale,
      }
    },
    [stageScale],
  )

  const handleStagePointerDown = useCallback(
    (event) => {
      const stage = event.target.getStage()
      if (!stage) {
        return
      }

      if (drawingState) {
        return
      }

      if (event.target !== stage) {
        return
      }

      if (mode === MODE_DRAW) {
        const imagePoint = pointerPositionToImage(stage)
        if (!imagePoint) {
          return
        }
        const newId = randomId()
        setAnnotations((prev) => [
          ...prev,
          {
            id: newId,
            text: '',
            label: 'text',
            x: imagePoint.x,
            y: imagePoint.y,
            width: 1,
            height: 1,
            rotation: 0,
            order: prev.length,
          },
        ])
        setDrawingState({
          id: newId,
          originX: imagePoint.x,
          originY: imagePoint.y,
        })
        setSelectedId(newId)
      } else {
        setSelectedId(null)
      }
    },
    [mode, pointerPositionToImage, setAnnotations, drawingState],
  )

  const handleStagePointerMove = useCallback(
    (event) => {
      if (!drawingState) {
        return
      }
      event.evt?.preventDefault?.()
      const stage = event.target.getStage()
      if (!stage) {
        return
      }
      const imagePoint = pointerPositionToImage(stage)
      if (!imagePoint) {
        return
      }
      const { id, originX, originY } = drawingState
      const deltaX = imagePoint.x - originX
      const deltaY = imagePoint.y - originY
      const nextWidth = Math.abs(deltaX)
      const nextHeight = Math.abs(deltaY)
      const nextX = deltaX >= 0 ? originX : imagePoint.x
      const nextY = deltaY >= 0 ? originY : imagePoint.y

      setAnnotations((prev) =>
        prev.map((annotation) =>
          annotation.id === id
            ? {
                ...annotation,
                x: nextX,
                y: nextY,
                width: nextWidth,
                height: nextHeight,
              }
            : annotation,
        ),
      )
    },
    [drawingState, pointerPositionToImage],
  )

  const handleStagePointerUp = useCallback(() => {
    if (!drawingState) {
      return
    }
    const { id } = drawingState
    let removedId = null
    setAnnotations((prev) => {
      const target = prev.find((annotation) => annotation.id === id)
      if (!target) {
        return prev
      }
      if (target.width < MIN_DRAW_SIZE || target.height < MIN_DRAW_SIZE) {
        removedId = target.id
        return prev.filter((annotation) => annotation.id !== target.id).map((annotation, index) => ({
          ...annotation,
          order: index,
        }))
      }
      return prev.map((annotation) =>
        annotation.id === id
          ? {
              ...annotation,
              width: Math.max(annotation.width, MIN_DRAW_SIZE),
              height: Math.max(annotation.height, MIN_DRAW_SIZE),
            }
          : annotation,
      )
    })
    if (removedId) {
      setSelectedId(null)
    }
    setDrawingState(null)
  }, [drawingState])

  const saveIndicatorMessage = useMemo(() => {
    switch (saveStatus.state) {
      case 'dirty':
        return '尚有未儲存的變更…'
      case 'saving':
        return '儲存中…'
      case 'saved':
        return saveStatus.updatedAt
          ? `上次自動儲存於 ${new Date(saveStatus.updatedAt).toLocaleTimeString()}`
          : '已完成儲存'
      case 'error':
        return saveStatus.error || '儲存失敗'
      default:
        return ''
    }
  }, [saveStatus])
  const canvasClassName = `annotator-canvas ${
    isDrawMode ? 'annotator-canvas--draw' : 'annotator-canvas--edit'
  }`

  if (!itemId) {
    return (
      <section className="page annotator-page">
        <h2>標註頁面</h2>
        <p>頁面識別碼不正確，請返回列表重新選擇。</p>
        <button type="button" onClick={handleBackToRecords}>
          返回記錄列表
        </button>
      </section>
    )
  }

  if (!workspace) {
    return (
      <section className="page annotator-page">
        <h2>標註頁面</h2>
        <p>請先前往 Workspace 清單，選擇欲瀏覽的 Workspace 後再進入標註介面。</p>
        <div className="annotator-actions">
          <button type="button" onClick={() => onNavigate('/workspaces')}>
            前往 Workspace 清單
          </button>
          <button type="button" onClick={onRefreshWorkspaces} className="ghost">
            重新整理 Workspace 狀態
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page annotator-page">
      <header className="annotator-header">
        <div>
          <h2>{filename}</h2>
          <p className="annotator-subtitle">
            Record: <code>{recordSlug}</code>
            {pageInfo.page ? ` • 原始尺寸 ${pageImage?.width ?? '…'}×${pageImage?.height ?? '…'}` : ''}
          </p>
        </div>
        <div className="annotator-header-actions">
          <div className="annotator-mode-toggle">
            <button
              type="button"
              className={isDrawMode ? 'active' : ''}
              aria-pressed={isDrawMode}
              onClick={() => {
                if (!isDrawMode) {
                  setMode(MODE_DRAW)
                }
              }}
            >
              標註模式
            </button>
            <button
              type="button"
              className={!isDrawMode ? 'active' : ''}
              aria-pressed={!isDrawMode}
              onClick={() => {
                if (isDrawMode) {
                  setMode(MODE_EDIT)
                }
              }}
            >
              文字編輯模式
            </button>
          </div>
          <button type="button" className="ghost" onClick={handleBackToRecords}>
            返回記錄列表
          </button>
        </div>
      </header>

      {pageInfo.loading ? (
        <div className="annotator-notice">頁面載入中…</div>
      ) : null}
      {pageInfo.error ? <div className="annotator-error">{pageInfo.error}</div> : null}
      {annotationsError ? <div className="annotator-error">{annotationsError}</div> : null}

      <div className="annotator-layout">
        <div className={canvasClassName} ref={stageContainerRef}>
          {pageInfo.page ? (
            <div className="annotator-stage">
              <Stage
                width={stageSize.width}
                height={stageSize.height}
                ref={stageRef}
                onMouseDown={handleStagePointerDown}
                onTouchStart={handleStagePointerDown}
                onMouseMove={handleStagePointerMove}
                onTouchMove={handleStagePointerMove}
                onMouseUp={handleStagePointerUp}
                onTouchEnd={handleStagePointerUp}
                onTouchCancel={handleStagePointerUp}
                onMouseLeave={handleStagePointerUp}
                style={{ cursor: isDrawMode ? 'crosshair' : 'default' }}
              >
                <Layer>
                  {pageImage ? (
                    <KonvaImage
                      image={pageImage}
                      width={pageImage.width * stageScale}
                      height={pageImage.height * stageScale}
                      listening={false}
                    />
                  ) : null}
                  {annotations.map((annotation) => {
                    const nodeKey = annotation.id
                    const scaledX = annotation.x * stageScale
                    const scaledY = annotation.y * stageScale
                    const scaledWidth = Math.max(annotation.width * stageScale, 1)
                    const scaledHeight = Math.max(annotation.height * stageScale, 1)

                    return (
                      <Rect
                        key={nodeKey}
                        ref={(node) => {
                          if (node) {
                            shapeRefs.current[nodeKey] = node
                          } else {
                            delete shapeRefs.current[nodeKey]
                          }
                        }}
                        x={scaledX}
                        y={scaledY}
                        width={scaledWidth}
                        height={scaledHeight}
                        rotation={annotation.rotation}
                        draggable
                        stroke={
                          annotation.id === selectedId ? palette.accent : 'rgba(0, 0, 0, 0.55)'
                        }
                        strokeWidth={annotation.id === selectedId ? 3 : 2}
                        dashEnabled={false}
                        fill="rgba(10, 46, 32, 0.18)"
                        onClick={(event) => {
                          event.cancelBubble = true
                          setSelectedId(annotation.id)
                        }}
                        onTap={(event) => {
                          event.cancelBubble = true
                          setSelectedId(annotation.id)
                        }}
                        onDragStart={(event) => {
                          event.cancelBubble = true
                          setSelectedId(annotation.id)
                        }}
                        onDragMove={(event) => {
                          event.cancelBubble = true
                        }}
                        onTransformStart={(event) => {
                          event.cancelBubble = true
                          setSelectedId(annotation.id)
                        }}
                        onDragEnd={(event) => {
                          const node = event.target
                          handleUpdateAnnotation(annotation.id, {
                            x: node.x() / stageScale,
                            y: node.y() / stageScale,
                          })
                        }}
                        onTransformEnd={(event) => {
                          const node = event.target
                          const scaleX = node.scaleX()
                          const scaleY = node.scaleY()
                          node.scaleX(1)
                          node.scaleY(1)
                          handleUpdateAnnotation(annotation.id, {
                            x: node.x() / stageScale,
                            y: node.y() / stageScale,
                            width: Math.max(
                              MIN_DRAW_SIZE,
                              (node.width() * scaleX) / stageScale,
                            ),
                            height: Math.max(
                              MIN_DRAW_SIZE,
                              (node.height() * scaleY) / stageScale,
                            ),
                            rotation: node.rotation(),
                          })
                        }}
                      />
                    )
                  })}
                  {annotations.map((annotation, index) => {
                    const displayOrder = Number.isFinite(annotation.order)
                      ? annotation.order + 1
                      : index + 1
                    const baseX = annotation.x * stageScale
                    const baseY = annotation.y * stageScale
                    const fontSize = Math.max(14, 16 * stageScale)
                    const padding = Math.max(4, 6 * stageScale)
                    const labelY = Math.max(baseY - (fontSize + padding * 2), 4)

                    return (
                      <Label
                        key={`${annotation.id}-order`}
                        x={baseX - padding}
                        y={labelY}
                        listening={false}
                      >
                        <Tag
                          fill="rgba(27, 94, 74, 0.9)"
                          cornerRadius={Math.max(6, 8 * stageScale)}
                          shadowColor="rgba(17, 24, 39, 0.25)"
                          shadowBlur={6}
                          shadowOpacity={0.6}
                          shadowOffset={{ x: 0, y: 2 }}
                        />
                        <KonvaText
                          text={`#${displayOrder}`}
                          fontSize={fontSize}
                          fontStyle="bold"
                          fill="#ffffff"
                          padding={padding}
                        />
                      </Label>
                    )
                  })}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled
                    keepRatio={false}
                    enabledAnchors={[
                      'top-left',
                      'top-right',
                      'bottom-left',
                      'bottom-right',
                      'top-center',
                      'bottom-center',
                      'middle-left',
                      'middle-right',
                    ]}
                    boundBoxFunc={(oldBox, newBox) => {
                      const projectedWidth = newBox.width / stageScale
                      const projectedHeight = newBox.height / stageScale
                      if (projectedWidth < MIN_DRAW_SIZE || projectedHeight < MIN_DRAW_SIZE) {
                        return oldBox
                      }
                      return newBox
                    }}
                  />
                </Layer>
              </Stage>
            </div>
          ) : (
            <div className="annotator-placeholder">尚未選取頁面或頁面載入失敗。</div>
          )}
        </div>

        <aside className="annotator-sidebar" style={{ backgroundColor: palette.surface }}>
          <div className="annotator-sidebar__header">
            <h3>標註清單</h3>
            <button type="button" onClick={handleAddAnnotation} disabled={!isDrawMode}>
              新增標註框
            </button>
          </div>
          <p className="annotator-save-indicator">{saveIndicatorMessage}</p>
          {saveStatus.state === 'error' ? (
            <button type="button" className="ghost" onClick={performSave}>
              重試儲存
            </button>
          ) : null}
          <div className="annotator-sidebar__content">
            {annotations.length === 0 ? (
              <p className="annotator-placeholder">
                尚未建立任何標註框，請於「標註模式」下拖曳畫面或點擊上方按鈕新增。
              </p>
            ) : (
              annotations.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  isSelected={annotation.id === selectedId}
                  onSelect={setSelectedId}
                  onChange={handleUpdateAnnotation}
                  onDelete={handleDeleteAnnotation}
                  palette={palette}
                  onBeginTextEdit={() => setMode(MODE_EDIT)}
                />
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
