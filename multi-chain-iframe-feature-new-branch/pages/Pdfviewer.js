import React, { useState, useRef } from 'react';
import styles from './index.module.css';  // Ensure the path is correctly specified

const PdfViewer = ({ onClose }) => {
  const [isVisible, setIsVisible] = useState(true);
  const viewerRef = useRef();

  const handleClose = () => {
    viewerRef.current.classList.remove(styles.slideUp);
    viewerRef.current.classList.add(styles.slideDown);
    setTimeout(onClose, 400);
  };

  // URL to open in the iframe
  const pageUrl = 'https://www.xion.global/pay-with-crypto';

  return (
    <div ref={viewerRef} className={`${styles.pdfViewer} ${isVisible ? styles.slideUp : ''}`}>
      <div className={styles.closeButton} onClick={handleClose}>X</div>
      <iframe
        src={pageUrl}
        className={styles.objectPdf}
        aria-label="Webpage viewer"
        frameBorder="0"
        style={{ width: '100%', height: '100%' }}
        allowFullScreen
      ></iframe>
    </div>
  );
};

export default PdfViewer;
