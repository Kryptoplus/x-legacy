// components/ScratchCard.js
import { useEffect } from 'react';
import styles from './ScratchCard.module.css';

const ScratchCard = () => {
  useEffect(() => {
    const canvas = document.getElementById('scratch');
    const context = canvas.getContext('2d');

    const init = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      let gradientColor = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradientColor.addColorStop(0, '#c3a3f1');
      gradientColor.addColorStop(1, '#6414e9');
      context.fillStyle = gradientColor;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = "#ffffff";
      context.font = "bold 10px Poppins, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("Scratch to Win", canvas.width / 2, canvas.height / 2);
    };

    let isDragging = false;

    const events = {
      mouse: { down: 'mousedown', move: 'mousemove', up: 'mouseup' },
      touch: { down: 'touchstart', move: 'touchmove', up: 'touchend' },
    };

    const isTouchDevice = () => {
      return 'ontouchstart' in window || navigator.maxTouchPoints;
    };

    const deviceType = isTouchDevice() ? 'touch' : 'mouse';

    const getXY = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (deviceType === 'touch') {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      } else {
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    };

    const scratch = (x, y) => {
      context.globalCompositeOperation = 'destination-out';
      context.beginPath();
      context.arc(x, y, 12, 0, Math.PI * 2);
      context.fill();
    };

    canvas.addEventListener(events[deviceType].down, (e) => {
      isDragging = true;
      const { x, y } = getXY(e);
      scratch(x, y);
    });

    canvas.addEventListener(events[deviceType].move, (e) => {
      if (!isDragging) return;
      const { x, y } = getXY(e);
      scratch(x, y);
    });

    canvas.addEventListener(events[deviceType].up, () => {
      isDragging = false;
    });

    canvas.addEventListener('mouseleave', () => {
      isDragging = false;
    });

    init();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.base}>
        {/* <h4>You Won</h4> */}
        <h3>$10</h3>
      </div>
      <canvas id="scratch" width="100" height="50" className={styles.scratch}></canvas>
    </div>
  );
};

export default ScratchCard;
