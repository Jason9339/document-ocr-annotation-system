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
import {
  MousePointer,
  BoxSelect,
  Trash2,
  CheckSquare,
  Pencil,
  SlidersHorizontal,
  Layers,
  ZoomIn,
  ZoomOut,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  Info,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'

const MIN_DRAW_SIZE = 12

const ANNOTATION_STAGES = [
  { id: 'layout', label: '框校正' },
  { id: 'text', label: '文字標註' },
]

const GROUP_COLORS = ['#2563eb', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#facc15']

function hexToRgba(hex, alpha) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!match) {
    return `rgba(17, 24, 39, ${alpha})`
  }
  const r = parseInt(match[1], 16)
  const g = parseInt(match[2], 16)
  const b = parseInt(match[3], 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function groupLabelFromIndex(index) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let value = index
  let label = ''
  while (value >= 0) {
    label = alphabet[value % 26] + label
    value = Math.floor(value / 26) - 1
  }
  return label || 'A'
}

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
      setImage(img)
    }
    img.onerror = () => {
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
    group_id: Number.isFinite(annotation.group_id) ? annotation.group_id : 0,
  }
}

function serialiseAnnotations(annotations) {
  return annotations.map(({ id, text, label, x, y, width, height, rotation, order, group_id }) => ({
    id,
    text,
    label,
    x,
    y,
    width,
    height,
    rotation,
    order,
    group_id: Number.isFinite(group_id) ? group_id : 0,
  }))
}

function AnnotationCard({
  annotation,
  isSelected,
  totalCount,
  onSelect,
  onDelete,
  onOrderChange,
  onUpdateText = () => {},
  palette,
  allowGrouping = false,
  groupOptions = [],
  onGroupChange = () => {},
  groupColor = '#94a3b8',
  showTextEditor = false,
  showOrderControls = true,
  showDelete = true,
}) {
  return (
    <div
      className={`annotation-card${isSelected ? ' annotation-card--active' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(annotation.id, event)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(annotation.id, event)
        }
      }}
      style={{ borderColor: isSelected ? palette.accent : undefined }}
    >
      <header>
        <div className="annotation-card__label">
          <span
            className="annotation-card__group-dot"
            style={{ backgroundColor: groupColor }}
            aria-hidden="true"
          />
          <span>{annotation.label}</span>
        </div>
        <span className="annotation-card__order">#{annotation.order + 1}</span>
      </header>
      {showTextEditor ? (
        <div className="annotation-card__text-editor">
          <textarea
            value={annotation.text}
            onChange={(event) => onUpdateText(annotation.id, event.target.value)}
            rows={2}
            placeholder="輸入文字…"
          />
        </div>
      ) : null}
      <div className="annotation-card__controls">
        <div className="annotation-card__extras">
          {allowGrouping ? (
            <label className="annotation-card__group-control">
              <span>群組</span>
              <div className="annotation-card__group-select">
                <span
                  className="annotation-card__group-dot annotation-card__group-dot--inline"
                  style={{ backgroundColor: groupColor }}
                  aria-hidden="true"
                />
                <select
                  value={
                    Number.isFinite(annotation.group_id)
                      ? String(annotation.group_id)
                      : '0'
                  }
                  onChange={(event) => onGroupChange(annotation.id, event.target.value)}
                >
                  {groupOptions.map((option) => (
                    <option key={option.id} value={String(option.id)}>
                      {option.label}
                    </option>
                  ))}
                  <option value="__new__">+ 新增群組</option>
                </select>
              </div>
            </label>
          ) : null}
          {showOrderControls ? (
            <label className="annotation-card__order-control">
              <span>請選擇插入位置</span>
              <select
                value={annotation.order}
                onChange={(event) => onOrderChange(annotation.id, Number(event.target.value))}
              >
                {Array.from({ length: totalCount }, (_, index) => (
                  <option key={index} value={index}>
                    #{index + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showDelete ? (
            <button
              type="button"
              className="annotation-card__delete"
              onClick={(event) => {
                event.stopPropagation()
                onDelete([annotation.id])
              }}
            >
              刪除
            </button>
          ) : null}
        </div>
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
  const [annotationStage, setAnnotationStage] = useState('layout')
  const [selectionRect, setSelectionRect] = useState(null)

  const [pageInfo, setPageInfo] = useState({
    loading: true,
    error: null,
    page: null,
  })
  const [annotations, setAnnotations] = useState([])
  const [annotationsReady, setAnnotationsReady] = useState(false)
  const [annotationsError, setAnnotationsError] = useState(null)
  const annotationsInitialised = useRef(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [selectionMode, setSelectionMode] = useState('single')
  const [sidebarView, setSidebarView] = useState('groups')
  const [saveStatus, setSaveStatus] = useState({
    state: 'idle',
    updatedAt: null,
    error: null,
  })
  const autosaveTimerRef = useRef(null)
  const stageContainerRef = useRef(null)
  const stageRef = useRef(null)
  const transformerRef = useRef(null)
  const shapeRefs = useRef({})
  const drawingStateRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 960, height: 640 })

  const workspace = workspaceState.current

  const handleBackToRecords = useCallback(() => {
    if (recordSlug) {
      onNavigate(`/records/${encodeURIComponent(recordSlug)}`)
    } else {
      onNavigate('/records')
    }
  }, [onNavigate, recordSlug])

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

    return { width, height, scale }
  }, [pageImage, containerSize])
  const stageScale = stageSize.scale || 1
  const isMultiSelectEnabled = selectionMode === 'multi'
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedAnnotations = useMemo(
    () => annotations.filter((annotation) => selectedSet.has(annotation.id)),
    [annotations, selectedSet],
  )
  const selectionGroupId = useMemo(() => {
    if (selectedAnnotations.length === 0) {
      return null
    }
    const firstGroup = Number.isFinite(selectedAnnotations[0].group_id)
      ? selectedAnnotations[0].group_id
      : 0
    const uniform = selectedAnnotations.every((annotation) => {
      const groupValue = Number.isFinite(annotation.group_id) ? annotation.group_id : 0
      return groupValue === firstGroup
    })
    return uniform ? firstGroup : null
  }, [selectedAnnotations])
  const selectionGroupValue = selectionGroupId === null ? '__mixed__' : String(selectionGroupId)
  const hasSelection = selectedIds.length > 0
  const allowGeometryEditing = annotationStage !== 'text'
  const allowGroupingOperations = annotationStage !== 'text'
  const showTextEditor = annotationStage === 'text'
  const showLayoutInsertControls = annotationStage === 'layout'

  useEffect(() => {
    if (showTextEditor || !allowGroupingOperations) {
      setSidebarView('annotations')
    } else if (!showTextEditor && allowGroupingOperations) {
      setSidebarView((prev) => (prev === 'annotations' ? 'groups' : prev))
    }
  }, [showTextEditor, allowGroupingOperations])
  const groupIds = useMemo(() => {
    const ids = new Set()
    annotations.forEach((annotation) => {
      ids.add(Number.isFinite(annotation.group_id) ? annotation.group_id : 0)
    })
    return Array.from(ids).sort((a, b) => a - b)
  }, [annotations])
  const groupColorMap = useMemo(() => {
    const map = new Map()
    groupIds.forEach((id, index) => {
      map.set(id, GROUP_COLORS[index % GROUP_COLORS.length])
    })
    return map
  }, [groupIds])
  const groupSequence = useMemo(() => {
    const firstOrderMap = new Map()
    annotations.forEach((annotation) => {
      const gid = Number.isFinite(annotation.group_id) ? annotation.group_id : 0
      const first = firstOrderMap.get(gid)
      if (first === undefined || annotation.order < first) {
        firstOrderMap.set(gid, annotation.order)
      }
    })
    return Array.from(firstOrderMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([gid]) => gid)
  }, [annotations])

  const groupOptions = useMemo(
    () =>
      groupSequence.map((gid, index) => {
        const letter = groupLabelFromIndex(index)
        return {
          id: gid,
          label: letter,
          letter,
          color: groupColorMap.get(gid) ?? '#94a3b8',
        }
      }),
    [groupSequence, groupColorMap],
  )
  const showGroupingColors = groupOptions.length > 0

  const normaliseGroupsAndOrder = useCallback((items) => {
    const ordered = items
      .map((annotation, index) => ({
        ...annotation,
        order: Number.isFinite(annotation.order) ? annotation.order : index,
        group_id: Number.isFinite(annotation.group_id) ? annotation.group_id : 0,
      }))
      .sort((a, b) => a.order - b.order)

    return ordered.map((annotation, index) => ({
      ...annotation,
      order: index,
    }))
  }, [])

  const setGroupForAnnotations = useCallback(
    (targetIds, groupValue) => {
      if (!allowGroupingOperations) {
        return
      }
      const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
      if (ids.length === 0) {
        return
      }
      setAnnotations((prev) => {
        const targetSet = new Set(ids)
        let resolvedGroupId = 0
        if (groupValue === 'new') {
          const maxGroup = prev.reduce(
            (max, annotation) =>
              Math.max(max, Number.isFinite(annotation.group_id) ? annotation.group_id : 0),
            -1,
          )
          resolvedGroupId = maxGroup + 1
        } else if (typeof groupValue === 'number' && Number.isFinite(groupValue)) {
          resolvedGroupId = groupValue
        } else {
          const numeric = Number(groupValue)
          resolvedGroupId = Number.isFinite(numeric) ? numeric : 0
        }
        const updated = prev.map((annotation) => {
          if (!targetSet.has(annotation.id)) {
            return { ...annotation }
          }
          return {
            ...annotation,
            group_id: resolvedGroupId,
          }
        })
        return normaliseGroupsAndOrder(updated)
      })
    },
    [allowGroupingOperations, normaliseGroupsAndOrder],
  )

  const handleSelectionGroupChange = useCallback(
    (value) => {
      if (!allowGroupingOperations || selectedIds.length === 0) {
        return
      }
      if (value === '__mixed__') {
        return
      }
      if (value === '__new__') {
        setGroupForAnnotations(selectedIds, 'new')
        return
      }
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) {
        return
      }
      setGroupForAnnotations(selectedIds, numeric)
    },
    [allowGroupingOperations, selectedIds, setGroupForAnnotations],
  )

  const handleCardGroupChange = useCallback(
    (id, value) => {
      if (!allowGroupingOperations) {
        return
      }
      if (value === '__new__') {
        setGroupForAnnotations([id], 'new')
        return
      }
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) {
        return
      }
      setGroupForAnnotations([id], numeric)
    },
    [allowGroupingOperations, setGroupForAnnotations],
  )

  const handleCreateGroupFromSelection = useCallback(() => {
    if (!allowGroupingOperations || selectedIds.length === 0) {
      return
    }
    setSelectionMode('multi')
    setGroupForAnnotations(selectedIds, 'new')
  }, [allowGroupingOperations, selectedIds, setGroupForAnnotations])

  const handleShiftGroup = useCallback(
    (groupId, direction) => {
      if (!allowGroupingOperations) {
        return
      }
      setAnnotations((prev) => {
        const orderMap = new Map()
        prev.forEach((annotation) => {
          const gid = Number.isFinite(annotation.group_id) ? annotation.group_id : 0
          const current = orderMap.get(gid)
          if (current === undefined || annotation.order < current) {
            orderMap.set(gid, annotation.order)
          }
        })
        const sequence = Array.from(orderMap.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([gid]) => gid)
        const currentIndex = sequence.indexOf(groupId)
        const targetIndex = currentIndex + direction
        if (currentIndex === -1 || targetIndex < 0 || targetIndex >= sequence.length) {
          return prev
        }
        const reorderedSequence = sequence.slice()
        const [moved] = reorderedSequence.splice(currentIndex, 1)
        reorderedSequence.splice(targetIndex, 0, moved)

        const grouped = new Map()
        prev.forEach((annotation) => {
          const gid = Number.isFinite(annotation.group_id) ? annotation.group_id : 0
          if (!grouped.has(gid)) {
            grouped.set(gid, [])
          }
          grouped.get(gid).push(annotation)
        })

        const reorderedAnnotations = []
        const seenAnnotationIds = new Set()
        reorderedSequence.forEach((gid) => {
          const groupItems = grouped.get(gid)
          if (groupItems) {
            groupItems
              .slice()
              .sort((a, b) => a.order - b.order)
              .forEach((annotation) => {
                reorderedAnnotations.push(annotation)
                seenAnnotationIds.add(annotation.id)
              })
          }
        })

        // Append any annotations belonging to groups that might not have been included above (safety net)
        prev.forEach((annotation) => {
          if (!seenAnnotationIds.has(annotation.id)) {
            reorderedAnnotations.push(annotation)
            seenAnnotationIds.add(annotation.id)
          }
        })

        return reorderedAnnotations.map((annotation, index) => ({
          ...annotation,
          order: index,
        }))
      })
    },
    [allowGroupingOperations],
  )

  const handleSelectGroup = useCallback(
    (groupId) => {
      const members = annotations
        .filter((annotation) => {
          const resolvedGroup = Number.isFinite(annotation.group_id)
            ? annotation.group_id
            : 0
          return resolvedGroup === groupId
        })
        .map((annotation) => annotation.id)
      if (members.length === 0) {
        return
      }
      setSelectionMode('multi')
      setSelectedIds(members)
    },
    [annotations],
  )

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
    setSelectionRect(null)
    if (annotationStage === 'text') {
      setSelectionMode('single')
      setSelectedIds((prev) => (prev.length > 0 ? [prev[prev.length - 1]] : []))
    }
  }, [annotationStage])

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
        const normalised = Array.isArray(payload.annotations)
          ? payload.annotations.map((annotation, index) => normaliseAnnotation(annotation, index))
          : []
        const ordered = normaliseGroupsAndOrder(normalised)
        setAnnotations(ordered)
        setAnnotationsReady(true)
        annotationsInitialised.current = true
        setSaveStatus({
          state: 'saved',
          updatedAt: payload.updated_at ?? new Date().toISOString(),
          error: null,
        })
        setSelectedIds(ordered[0] ? [ordered[0].id] : [])
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setAnnotations([])
        setAnnotationsReady(true)
        annotationsInitialised.current = true
        setAnnotationsError(err.message ?? '無法載入標註檔案。')
      })

    return () => {
      cancelled = true
    }
  }, [itemId, workspace, normaliseGroupsAndOrder])

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
    if (!allowGeometryEditing) {
      transformer.nodes([])
      transformer.getLayer()?.batchDraw()
      return
    }
    // Attach transformer only when exactly one box is selected
    if (selectedIds.length === 1) {
      const node = shapeRefs.current[selectedIds[0]]
      if (node) {
        transformer.nodes([node])
        transformer.getLayer()?.batchDraw()
      } else {
        transformer.nodes([])
        transformer.getLayer()?.batchDraw()
      }
    } else {
      // Multiple or no selection - don't show transformer
      transformer.nodes([])
      transformer.getLayer()?.batchDraw()
    }
  }, [selectedIds, annotations, allowGeometryEditing])

  const [drawMode, setDrawMode] = useState(false)
  const [showDirectionHelp, setShowDirectionHelp] = useState(false)

  useEffect(() => {
    if (drawMode) {
      setSelectionMode('single')
    }
  }, [drawMode])

  useEffect(() => {
    if (!allowGeometryEditing && drawMode) {
      setDrawMode(false)
      drawingStateRef.current = null
    }
  }, [allowGeometryEditing, drawMode])

  const handleAddAnnotation = useCallback(() => {
    if (!allowGeometryEditing) {
      return
    }
    setDrawMode((prev) => !prev)
  }, [allowGeometryEditing])

  const handleUpdateAnnotation = useCallback((id, payload) => {
    if (!allowGeometryEditing && ('x' in payload || 'y' in payload || 'width' in payload || 'height' in payload || 'rotation' in payload)) {
      return
    }
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

  const handleDeleteAnnotations = useCallback(
    (ids) => {
      const targetIds = Array.isArray(ids) ? ids : [ids]
      if (!targetIds.length) {
        return
      }
      const targetSet = new Set(targetIds)
      setAnnotations((prev) => {
        const filtered = prev.filter((annotation) => !targetSet.has(annotation.id))
        return filtered.map((annotation, index) => ({
          ...annotation,
          order: index,
        }))
      })
      setSelectedIds([])
    },
    [],
  )

  const handleUpdateAnnotationText = useCallback((id, text) => {
    setAnnotations((prev) =>
      prev.map((annotation) => {
        if (annotation.id !== id) {
          return annotation
        }
        return {
          ...annotation,
          text,
        }
      }),
    )
  }, [])

  const findAnnotationIdByNode = useCallback((node) => {
    if (!node) {
      return null
    }
    for (const [id, refNode] of Object.entries(shapeRefs.current)) {
      if (refNode === node) {
        return id
      }
    }
    return null
  }, [])

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

  const isAdditiveEvent = useCallback(
    (evt) => {
      const nativeEvent = evt?.evt ?? evt
      return (
        isMultiSelectEnabled ||
        Boolean(nativeEvent?.shiftKey || nativeEvent?.metaKey || nativeEvent?.ctrlKey)
      )
    },
    [isMultiSelectEnabled],
  )

  const updateSelection = useCallback((id, { additive } = {}) => {
    if (!id) {
      setSelectedIds([])
      return
    }
    setSelectedIds((prev) => {
      const exists = prev.includes(id)
      if (additive) {
        if (exists) {
          return prev.filter((item) => item !== id)
        }
        return [...prev, id]
      }
      if (prev.length === 1 && exists) {
        return prev
      }
      return [id]
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds([])
  }, [])

  const selectAllAnnotations = useCallback(() => {
    setSelectedIds(annotations.map((annotation) => annotation.id))
  }, [annotations])

  const handleSelectAnnotation = useCallback(
    (id, evt) => {
      const additive = evt ? isAdditiveEvent(evt) : false
      updateSelection(id, { additive })
    },
    [isAdditiveEvent, updateSelection],
  )

  const handleReorderAnnotation = useCallback((id, targetIndex) => {
    setAnnotations((prev) => {
      const ordered = [...prev].sort((a, b) => a.order - b.order)
      const currentIndex = ordered.findIndex((annotation) => annotation.id === id)
      if (currentIndex === -1) {
        return prev
      }
      const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length - 1))
      const [target] = ordered.splice(currentIndex, 1)
      ordered.splice(clampedIndex, 0, target)
      return ordered.map((annotation, index) => ({
        ...annotation,
        order: index,
      }))
    })
    setSelectedIds([id])
  }, [])

  const handleToggleSelectionMode = useCallback(() => {
    if (annotationStage === 'text') {
      return
    }
    setSelectionMode((prev) => {
      if (prev === 'multi') {
        setSelectedIds((ids) => (ids.length > 0 ? [ids[ids.length - 1]] : []))
        return 'single'
      }
      return 'multi'
    })
  }, [annotationStage])

  const handleDeleteSelected = useCallback(() => {
    if (!allowGeometryEditing || selectedIds.length === 0) {
      return
    }
    handleDeleteAnnotations(selectedIds)
  }, [allowGeometryEditing, handleDeleteAnnotations, selectedIds])

  const handleArrangeSelection = useCallback(
    (direction) => {
      if (selectedIds.length < 2) {
        return
      }
      setAnnotations((prev) => {
        const selectedSet = new Set(selectedIds)
        const selectedAnnotations = prev.filter((ann) => selectedSet.has(ann.id))
        const otherAnnotations = prev.filter((ann) => !selectedSet.has(ann.id))

        // Sort selected annotations based on direction
        let sorted = []
        if (direction === 'left-to-right') {
          sorted = selectedAnnotations.slice().sort((a, b) => a.x - b.x)
        } else if (direction === 'right-to-left') {
          sorted = selectedAnnotations.slice().sort((a, b) => b.x - a.x)
        } else if (direction === 'top-to-bottom') {
          sorted = selectedAnnotations.slice().sort((a, b) => a.y - b.y)
        }

        // Find the minimum order among selected annotations
        const minOrder = Math.min(...selectedAnnotations.map((ann) => ann.order))

        // Assign new orders to sorted annotations
        const updatedSelected = sorted.map((ann, index) => ({
          ...ann,
          order: minOrder + index,
        }))

        // Shift other annotations' orders if needed
        const updatedOthers = otherAnnotations.map((ann) => {
          if (ann.order >= minOrder && ann.order < minOrder + sorted.length) {
            return { ...ann, order: ann.order + sorted.length }
          }
          return ann
        })

        // Combine and normalize
        const combined = [...updatedSelected, ...updatedOthers].sort((a, b) => a.order - b.order)
        return combined.map((ann, index) => ({ ...ann, order: index }))
      })
    },
    [selectedIds],
  )

  const handleStagePointerDown = useCallback(
    (event) => {
      const targetNode = event.target
      const stage = targetNode.getStage()
      if (!stage) {
        return
      }
      const clickedAnnotationId = findAnnotationIdByNode(targetNode)

      if (drawMode && allowGeometryEditing) {
        if (targetNode !== stage) {
          return
        }
        const pointer = pointerPositionToImage(stage)
        if (!pointer) {
          return
        }
        const newId = randomId()
        setAnnotations((prev) => {
          const maxGroup = prev.reduce(
            (max, annotation) =>
              Math.max(max, Number.isFinite(annotation.group_id) ? annotation.group_id : 0),
            0,
          )
          const created = normaliseAnnotation(
            {
              id: newId,
              text: '',
              x: pointer.x,
              y: pointer.y,
              width: 1,
              height: 1,
              order: prev.length,
              group_id: maxGroup,
            },
            prev.length,
          )
          return normaliseGroupsAndOrder([...prev, created])
        })
        drawingStateRef.current = {
          id: newId,
          originX: pointer.x,
          originY: pointer.y,
        }
        setSelectedIds([newId])
        return
      }

      const targetClass = typeof targetNode.getClassName === 'function' ? targetNode.getClassName() : ''
      const isBackground = !clickedAnnotationId && (targetNode === stage || targetClass === 'Image')

      // Don't clear selection if clicking on transformer or its children
      const isTransformerNode = targetClass === 'Transformer' || targetNode.getParent()?.getClassName?.() === 'Transformer'

      if (!clickedAnnotationId && !isMultiSelectEnabled && !isTransformerNode) {
        clearSelection()
      }

      if (!isBackground) {
        return
      }

      if (isMultiSelectEnabled) {
        if (!isAdditiveEvent(event)) {
          clearSelection()
        }
        const imagePoint = pointerPositionToImage(stage)
        if (!imagePoint) {
          return
        }
        setSelectionRect({
          originX: imagePoint.x,
          originY: imagePoint.y,
          x: imagePoint.x,
          y: imagePoint.y,
          active: true,
        })
      } else {
        clearSelection()
      }
    },
    [
      allowGeometryEditing,
      clearSelection,
      drawMode,
      findAnnotationIdByNode,
      isAdditiveEvent,
      isMultiSelectEnabled,
      normaliseGroupsAndOrder,
      pointerPositionToImage,
      setAnnotations,
    ],
  )

  const handleStagePointerMove = useCallback(
    (event) => {
      const drawingState = drawingStateRef.current
      if (drawingState) {
        const stage = event.target.getStage()
        if (!stage) {
          return
        }
        const pointer = pointerPositionToImage(stage)
        if (!pointer) {
          return
        }
        const deltaX = pointer.x - drawingState.originX
        const deltaY = pointer.y - drawingState.originY
        const nextWidth = Math.abs(deltaX)
        const nextHeight = Math.abs(deltaY)
        const nextX = deltaX >= 0 ? drawingState.originX : pointer.x
        const nextY = deltaY >= 0 ? drawingState.originY : pointer.y
        setAnnotations((prev) =>
          prev.map((annotation) =>
            annotation.id === drawingState.id
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
        return
      }

      if (!selectionRect?.active) {
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
      setSelectionRect((prev) =>
        prev
          ? {
              ...prev,
              x: imagePoint.x,
              y: imagePoint.y,
            }
          : prev,
      )
    },
    [pointerPositionToImage, selectionRect?.active],
  )

  const handleStagePointerUp = useCallback(
    (event) => {
      const drawingState = drawingStateRef.current
      if (drawingState) {
        let removedId = null
        setAnnotations((prev) => {
          const target = prev.find((annotation) => annotation.id === drawingState.id)
          if (!target) {
            return prev
          }
          if (target.width < MIN_DRAW_SIZE || target.height < MIN_DRAW_SIZE) {
            removedId = target.id
            return prev
              .filter((annotation) => annotation.id !== target.id)
              .map((annotation, index) => ({
                ...annotation,
                order: index,
              }))
          }
          return prev.map((annotation) =>
            annotation.id === target.id
              ? {
                  ...annotation,
                  width: Math.max(target.width, MIN_DRAW_SIZE),
                  height: Math.max(target.height, MIN_DRAW_SIZE),
                }
              : annotation,
          )
        })
        if (removedId) {
          setSelectedIds([])
        }
        drawingStateRef.current = null
        return
      }

      if (!selectionRect?.active) {
        return
      }
      const stage = event.target.getStage()
      const imagePoint = stage ? pointerPositionToImage(stage) : null
      if (imagePoint) {
        setSelectionRect((prev) =>
          prev
            ? {
                ...prev,
                x: imagePoint.x,
                y: imagePoint.y,
              }
            : prev,
        )
      }

      setSelectionRect((prev) => {
        if (!prev) {
          return null
        }
        const left = Math.min(prev.originX, prev.x)
        const right = Math.max(prev.originX, prev.x)
        const top = Math.min(prev.originY, prev.y)
        const bottom = Math.max(prev.originY, prev.y)

        if (Math.abs(right - left) < 2 && Math.abs(bottom - top) < 2) {
          return null
        }

        const nextSelected = annotations
          .filter((annotation) => {
            const aLeft = annotation.x
            const aRight = annotation.x + annotation.width
            const aTop = annotation.y
            const aBottom = annotation.y + annotation.height
            return left <= aRight && right >= aLeft && top <= aBottom && bottom >= aTop
          })
          .map((annotation) => annotation.id)

        if (nextSelected.length > 0) {
          setSelectedIds(nextSelected)
        }

        return null
      })
    },
    [annotations, pointerPositionToImage, selectionRect],
  )

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

  const multiSelectionBounds = useMemo(() => {
    if (selectedIds.length < 2) {
      return null
    }
    const selectedAnnotations = annotations.filter((ann) => selectedSet.has(ann.id))
    if (selectedAnnotations.length === 0) {
      return null
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    selectedAnnotations.forEach((ann) => {
      minX = Math.min(minX, ann.x)
      minY = Math.min(minY, ann.y)
      maxX = Math.max(maxX, ann.x + ann.width)
      maxY = Math.max(maxY, ann.y + ann.height)
    })

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }, [selectedIds, annotations, selectedSet])

  const [viewportScale, setViewportScale] = useState(1)
  const canvasClassName = 'annotator-canvas'

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
        <div className="annotator-header__centred">
          <div className="annotator-mode-toggle" role="group" aria-label="標註階段">
            {ANNOTATION_STAGES.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={`annotator-mode-button${annotationStage === stage.id ? ' active' : ''}`}
                onClick={() => setAnnotationStage(stage.id)}
                aria-pressed={annotationStage === stage.id}
              >
                {stage.label}
              </button>
            ))}
          </div>
        </div>
        <div className="annotator-header-actions">
          <button type="button" className="ghost" onClick={handleBackToRecords}>
            返回記錄列表
          </button>
        </div>
      </header>

      <div className="annotator-tools annotator-tools--global">
        <button
          type="button"
          className={`annotator-tool-button${drawMode ? ' active' : ''}`}
          data-toolbar
          onClick={handleAddAnnotation}
          title={drawMode ? '停用繪製模式' : '啟用繪製模式'}
          disabled={!allowGeometryEditing}
        >
          <Pencil size={16} />
          <span>{drawMode ? '繪製中' : '繪製'}</span>
        </button>
        <button
          type="button"
          className={`annotator-tool-button${!isMultiSelectEnabled ? ' active' : ''}`}
          data-toolbar
          onClick={() => {
            setSelectionMode('single')
          }}
          title="單選編輯標註"
          aria-pressed={!isMultiSelectEnabled}
          disabled={drawMode || annotationStage === 'text'}
        >
          <MousePointer size={16} />
          <span>單選</span>
        </button>
        <button
          type="button"
          className={`annotator-tool-button${isMultiSelectEnabled ? ' active' : ''}`}
          data-toolbar
          onClick={handleToggleSelectionMode}
          title={isMultiSelectEnabled ? '切換為單選' : '啟用多選'}
          aria-pressed={isMultiSelectEnabled}
          disabled={drawMode || annotationStage === 'text'}
        >
          <BoxSelect size={16} />
          <span>多選</span>
        </button>
        <button
          type="button"
          className="annotator-tool-button"
          data-toolbar
          onClick={handleCreateGroupFromSelection}
          title="將選取框組成一個新群組"
          disabled={drawMode || !allowGroupingOperations || selectedIds.length === 0}
        >
          <Layers size={16} />
          <span>群組</span>
        </button>
        <button
          type="button"
          className="annotator-tool-button"
          data-toolbar
          onClick={handleDeleteSelected}
          title="刪除選取標註"
          disabled={drawMode || !hasSelection || !allowGeometryEditing}
        >
          <Trash2 size={16} />
          <span>刪除</span>
        </button>
        <button
          type="button"
          className="annotator-tool-button"
          data-toolbar
          onClick={selectAllAnnotations}
          title="全選"
          disabled={drawMode || annotations.length === 0 || selectedIds.length === annotations.length}
        >
          <CheckSquare size={16} />
          <span>全選</span>
        </button>
        <button
          type="button"
          className="annotator-tool-button"
          data-toolbar
          onClick={() => {
            if (drawMode) {
              return
            }
            setViewportScale((value) => Math.min(3, parseFloat((value + 0.15).toFixed(2))))
          }}
          title="放大"
          disabled={drawMode}
        >
          <ZoomIn size={16} />
          <span>放大</span>
        </button>
        <button
          type="button"
          className="annotator-tool-button"
          data-toolbar
          onClick={() => {
            if (drawMode) {
              return
            }
            setViewportScale((value) => Math.max(0.4, parseFloat((value - 0.15).toFixed(2))))
          }}
          title="縮小"
          disabled={drawMode}
        >
          <ZoomOut size={16} />
          <span>縮小</span>
        </button>
      </div>

      {pageInfo.loading ? (
        <div className="annotator-notice">頁面載入中…</div>
      ) : null}
      {pageInfo.error ? <div className="annotator-error">{pageInfo.error}</div> : null}
      {annotationsError ? <div className="annotator-error">{annotationsError}</div> : null}

      <div className="annotator-layout">
        <div
          className={canvasClassName}
          ref={stageContainerRef}
          style={{ transform: `scale(${viewportScale})`, transformOrigin: 'top center' }}
        >
          {multiSelectionBounds && selectedIds.length >= 2 && !drawMode ? (
            <div
              className="multi-selection-toolbar"
              style={{
                position: 'absolute',
                left: `${multiSelectionBounds.x * stageScale}px`,
                top: `${Math.max(0, multiSelectionBounds.y * stageScale - 50)}px`,
                zIndex: 1000,
              }}
            >
              <button
                type="button"
                className="multi-selection-toolbar__button"
                onClick={() => handleArrangeSelection('left-to-right')}
                title="從左到右排序"
              >
                <ArrowRight size={18} />
              </button>
              <button
                type="button"
                className="multi-selection-toolbar__button"
                onClick={() => handleArrangeSelection('right-to-left')}
                title="從右到左排序"
              >
                <ArrowLeft size={18} />
              </button>
              <button
                type="button"
                className="multi-selection-toolbar__button"
                onClick={() => handleArrangeSelection('top-to-bottom')}
                title="從上到下排序"
              >
                <ArrowDown size={18} />
              </button>
              <button
                type="button"
                className="multi-selection-toolbar__button multi-selection-toolbar__button--help"
                onClick={() => setShowDirectionHelp(true)}
                title="說明"
              >
                <Info size={18} />
              </button>
            </div>
          ) : null}
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
                style={{ cursor: 'default' }}
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
                    const rawGroupId = Number.isFinite(annotation.group_id) ? annotation.group_id : 0
                    const groupColor = groupColorMap.get(rawGroupId) ?? '#2563eb'
                    const isSelected = selectedSet.has(annotation.id)
                    const strokeColor = isSelected
                      ? '#2563eb'
                      : showGroupingColors
                        ? groupColor
                        : 'rgba(0, 0, 0, 0.55)'
                    const fillColor = showGroupingColors
                      ? hexToRgba(groupColor, isSelected ? 0.35 : 0.16)
                      : 'rgba(10, 46, 32, 0.18)'
                    const orderBadgeFill = showGroupingColors
                      ? hexToRgba(groupColor, 0.85)
                      : 'rgba(27, 94, 74, 0.9)'
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
                        draggable={allowGeometryEditing}
                        stroke={strokeColor}
                        strokeWidth={isSelected ? 4 : 2}
                        dashEnabled={false}
                        fill={fillColor}
                        onClick={(event) => {
                          event.cancelBubble = true
                          handleSelectAnnotation(annotation.id, event)
                        }}
                        onTap={(event) => {
                          event.cancelBubble = true
                          handleSelectAnnotation(annotation.id, event)
                        }}
                        onDragStart={(event) => {
                          event.cancelBubble = true
                          if (!allowGeometryEditing) {
                            return
                          }
                          updateSelection(annotation.id)
                        }}
                        onDragMove={(event) => {
                          event.cancelBubble = true
                        }}
                        onTransformStart={(event) => {
                          event.cancelBubble = true
                          if (!allowGeometryEditing) {
                            return
                          }
                          updateSelection(annotation.id)
                        }}
                        onDragEnd={(event) => {
                          const node = event.target
                          if (!allowGeometryEditing) {
                            node.position({
                              x: scaledX,
                              y: scaledY,
                            })
                            return
                          }
                          handleUpdateAnnotation(annotation.id, {
                            x: node.x() / stageScale,
                            y: node.y() / stageScale,
                          })
                        }}
                        onTransformEnd={(event) => {
                          const node = event.target
                          if (!allowGeometryEditing) {
                            node.rotation(annotation.rotation)
                            node.scaleX(1)
                            node.scaleY(1)
                            node.width(scaledWidth)
                            node.height(scaledHeight)
                            node.position({ x: scaledX, y: scaledY })
                            return
                          }
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
                  const rawGroupId = Number.isFinite(annotation.group_id) ? annotation.group_id : 0
                  const groupColor = groupColorMap.get(rawGroupId) ?? '#2563eb'
                  const isSelected = selectedSet.has(annotation.id)
                  const orderBadgeFill = showGroupingColors
                    ? hexToRgba(groupColor, isSelected ? 0.95 : 0.85)
                    : isSelected
                      ? '#2563eb'
                      : 'rgba(27, 94, 74, 0.9)'

                    return (
                      <Label
                        key={`${annotation.id}-order`}
                        x={baseX - padding}
                        y={labelY}
                        listening={false}
                      >
                        <Tag
                          fill={orderBadgeFill}
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
                  {selectionRect?.active ? (
                    <Rect
                      x={Math.min(selectionRect.originX, selectionRect.x) * stageScale}
                      y={Math.min(selectionRect.originY, selectionRect.y) * stageScale}
                      width={Math.abs(selectionRect.x - selectionRect.originX) * stageScale}
                      height={Math.abs(selectionRect.y - selectionRect.originY) * stageScale}
                      stroke="#111827"
                      strokeWidth={1.5}
                      dash={[6, 4]}
                      fill="rgba(17, 24, 39, 0.12)"
                      listening={false}
                    />
                  ) : null}
                  {allowGeometryEditing ? (
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
                  ) : null}
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
            <div className="annotator-sidebar__view-toggle" role="group" aria-label="清單視圖">
              {allowGroupingOperations ? (
                <button
                  type="button"
                  className={`annotator-sidebar__view-button${sidebarView === 'groups' ? ' active' : ''}`}
                  onClick={() => setSidebarView('groups')}
                  aria-pressed={sidebarView === 'groups'}
                  disabled={showTextEditor}
                >
                  群組
                </button>
              ) : null}
              <button
                type="button"
                className={`annotator-sidebar__view-button${sidebarView === 'annotations' ? ' active' : ''}`}
                onClick={() => setSidebarView('annotations')}
                aria-pressed={sidebarView === 'annotations'}
              >
                單一框
              </button>
            </div>
          </div>
          <p className="annotator-save-indicator">{saveIndicatorMessage}</p>
          {saveStatus.state === 'error' ? (
            <button type="button" className="ghost" onClick={performSave}>
              重試儲存
            </button>
          ) : null}
          {sidebarView === 'groups' && !showTextEditor && allowGroupingOperations ? (
            <div className="annotator-group-panel">
              <div className="annotator-group-panel__row">
                <label className="annotator-group-panel__field">
                  <span>選取框的群組</span>
                  <select
                    value={selectionGroupValue}
                    disabled={!hasSelection}
                    onChange={(event) => handleSelectionGroupChange(event.target.value)}
                  >
                    {selectionGroupId === null ? (
                      <option value="__mixed__" disabled>
                        多個群組
                      </option>
                    ) : null}
                    {groupOptions.map((option) => (
                      <option key={option.id} value={String(option.id)}>
                        {option.label}
                      </option>
                    ))}
                    <option value="__new__">+ 新增群組</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="annotator-group-panel__button"
                  onClick={() => setGroupForAnnotations(selectedIds, 'new')}
                  disabled={!hasSelection}
                >
                  建立新群組
                </button>
              </div>
              <div className="annotator-group-order">
                {groupOptions.map((option, index) => (
                  <div
                    key={option.id}
                    className="annotator-group-order__item"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectGroup(option.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleSelectGroup(option.id)
                      }
                    }}
                  >
                    <span
                      className="annotator-group-order__badge"
                      style={{ backgroundColor: option.color }}
                    >
                      {option.label}
                    </span>
                    <div className="annotator-group-order__actions">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleShiftGroup(option.id, -1)
                        }}
                        disabled={index === 0}
                        aria-label={`${option.label} 上移`}
                      >
                        上
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleShiftGroup(option.id, 1)
                        }}
                        disabled={index === groupOptions.length - 1}
                        aria-label={`${option.label} 下移`}
                      >
                        下
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="annotator-sidebar__content">
            {sidebarView === 'annotations' || showTextEditor ? (
              annotations.length === 0 ? (
                <p className="annotator-placeholder">
                  尚未建立任何標註框，請於「標註模式」下拖曳畫面或使用工具列新增。
                </p>
              ) : (
                annotations.map((annotation) => {
                  const resolvedGroupId = Number.isFinite(annotation.group_id)
                    ? annotation.group_id
                    : 0
                  const cardGroupColor = groupColorMap.get(resolvedGroupId) ?? '#94a3b8'
                  return (
                    <AnnotationCard
                      key={annotation.id}
                      annotation={annotation}
                      isSelected={selectedSet.has(annotation.id)}
                      totalCount={annotations.length}
                      onSelect={handleSelectAnnotation}
                      onDelete={handleDeleteAnnotations}
                      onOrderChange={handleReorderAnnotation}
                      onUpdateText={handleUpdateAnnotationText}
                      palette={palette}
                      allowGrouping={!showTextEditor && allowGroupingOperations}
                      groupOptions={showTextEditor ? [] : groupOptions}
                      onGroupChange={handleCardGroupChange}
                      groupColor={cardGroupColor}
                      showTextEditor={showTextEditor}
                      showOrderControls={!showTextEditor}
                      showDelete={!showTextEditor}
                    />
                  )
                })
              )
            ) : sidebarView === 'groups' ? (
              <p className="annotator-placeholder annotator-placeholder--compact">
                於左側「群組」檢視調整設定後，可切換回「單一框」檢視。
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {showDirectionHelp ? (
        <div className="direction-help-modal" onClick={() => setShowDirectionHelp(false)}>
          <div className="direction-help-modal__content" onClick={(e) => e.stopPropagation()}>
            <div className="direction-help-modal__header">
              <h3>排序方向說明</h3>
              <button
                type="button"
                className="direction-help-modal__close"
                onClick={() => setShowDirectionHelp(false)}
                aria-label="關閉"
              >
                <X size={20} />
              </button>
            </div>
            <div className="direction-help-modal__body">
              <div className="direction-help-item">
                <h4>
                  <ArrowRight size={20} />
                  從左到右
                </h4>
                <div className="direction-help-item__placeholder">
                  {/* 在此處添加示意圖 */}
                  <p>示意圖位置：依照選取框的 X 座標由小到大排序</p>
                </div>
              </div>
              <div className="direction-help-item">
                <h4>
                  <ArrowLeft size={20} />
                  從右到左
                </h4>
                <div className="direction-help-item__placeholder">
                  {/* 在此處添加示意圖 */}
                  <p>示意圖位置：依照選取框的 X 座標由大到小排序</p>
                </div>
              </div>
              <div className="direction-help-item">
                <h4>
                  <ArrowDown size={20} />
                  從上到下
                </h4>
                <div className="direction-help-item__placeholder">
                  {/* 在此處添加示意圖 */}
                  <p>示意圖位置：依照選取框的 Y 座標由小到大排序</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
