// pages/LoginSplash.js
import styles from "./LoginSplash.module.css";
import { FaCheckCircle } from "react-icons/fa";
import CustomConnectButton from "./CustomConnectButton";

const LoginSplash = ({ selectedNetwork }) => (
  <div className={styles.splashContainer}>
    <h1 className={styles.splashTitle}>
      Get your crypto<br />in the game now
    </h1>
    
    <CustomConnectButton
      buttonImage="./media/image.png"
      selectedNetwork={selectedNetwork}
    />
    <div className={styles.splashTrusted}>
      <FaCheckCircle className={styles.splashCheck} />
      Trusted by 10,000+ players &nbsp;•&nbsp; Instant deposits &nbsp;•&nbsp; Secure wallet
    </div>
  </div>
);

export default LoginSplash;