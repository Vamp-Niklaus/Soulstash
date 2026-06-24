import React, { useRef, useEffect, useState } from 'react';

export function MarqueeText({ text = '', maxChars = 25 }) {
  const isLong = text.length > maxChars;
  if (!isLong) {
    return <span className="truncate">{text}</span>;
  }
  // Duplicate content so translateX(-50%) produces a seamless infinite loop
  const content = text + '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0'; // gap between repetitions
  return (
    <span className="marquee-wrapper">
      <span className="marquee-content">{content}{content}</span>
    </span>
  );
}

export function HoverMarqueeTitle({ title }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    function measureOverflow() {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) return;
      setIsOverflowing(text.scrollWidth - container.clientWidth > 2);
    }

    measureOverflow();
    window.addEventListener('resize', measureOverflow);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measureOverflow());
      if (containerRef.current) observer.observe(containerRef.current);
      if (textRef.current) observer.observe(textRef.current);
    }

    return () => {
      window.removeEventListener('resize', measureOverflow);
      observer?.disconnect();
    };
  }, [title]);

  return (
    <div
      ref={containerRef}
      className={`search-hover-marquee ${isOverflowing ? 'is-overflowing' : ''}`}
      title={title}
    >
      <span className="search-hover-marquee__track">
        <span ref={textRef} className="search-hover-marquee__text">{title}</span>
        {isOverflowing ? (
          <span className="search-hover-marquee__text search-hover-marquee__text--clone" aria-hidden="true">
            {title}
          </span>
        ) : null}
      </span>
    </div>
  );
}

