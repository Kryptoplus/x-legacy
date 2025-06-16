import { useRouter } from 'next/router';

const AddressPage = () => {
  const router = useRouter();
  const { address } = router.query;

  // The rest of your component logic...
};

export default AddressPage;
