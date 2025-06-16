import React from 'react';
import styles from './Spinner.module.css'; // Import CSS styles for the spinner

const Spinner = () => {
  return (
    <div className={styles.spinnerOverlay}>
      <div className={styles.spinnerContainer}>
        <img 
          src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2dnbXpuZnMzbGlsY2Z3cWZtaXQxY2owZXFveGNjZjVxbHhleDA3eSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/tFryTjnGt2H44C2KDW/giphy.gif" // Replace with your preferred spinner gif
          alt="Loading..."
          className={styles.spinner}
        />
      </div>
    </div>
  );
};

export default Spinner;
