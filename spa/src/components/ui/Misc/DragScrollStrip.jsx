import React, { useRef, useState } from 'react';

export function DragScrollStrip({ className = '', children, innerClassName = '' , scrollRef = null }) {
  const localRef = useRef(null);
  const dragStateRef = useRef({
    isPointerDown: false,
    startX: 0,
    startScrollLeft: 0,
    hasDragged: false
  });

  const resolvedRef = scrollRef || localRef;

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = resolvedRef.current;
    if (!node) return;
    dragStateRef.current = {
      isPointerDown: true,
      startX: event.clientX,
      startScrollLeft: node.scrollLeft,
      hasDragged: false
    };
    node.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    const node = resolvedRef.current;
    const dragState = dragStateRef.current;
    if (!node || !dragState.isPointerDown) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      dragState.hasDragged = true;
    }
    node.scrollLeft = dragState.startScrollLeft - deltaX;
  }

  function handlePointerUp(event) {
    const node = resolvedRef.current;
    dragStateRef.current.isPointerDown = false;
    node?.releasePointerCapture?.(event.pointerId);
  }

  function handleClickCapture(event) {
    if (!dragStateRef.current.hasDragged) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current.hasDragged = false;
  }

  return (
    <div
      ref={resolvedRef}
      className={`filter-scrollbar-hidden overflow-x-auto overflow-y-hidden cursor-grab active:cursor-grabbing select-none touch-pan-x ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      <div className={`flex min-w-max flex-nowrap items-center gap-2 ${innerClassName}`}>
        {children}
      </div>
    </div>
  );
}

