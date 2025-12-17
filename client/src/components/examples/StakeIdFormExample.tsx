import { useState } from "react";
import StakeIdForm from "../StakeIdForm";

export default function StakeIdFormExample() {
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (stakeId: string) => {
    console.log("Checking tickets for:", stakeId);
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1500);
  };

  return (
    <StakeIdForm 
      onSubmit={handleSubmit} 
      isLoading={isLoading}
    />
  );
}
