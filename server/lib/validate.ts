import { stakeIdSchema } from "@shared/schema";
import { ZodError } from "zod";

export function validateStakeId(stakeId: unknown): { valid: true; stakeId: string } | { valid: false; error: string } {
  try {
    const validated = stakeIdSchema.parse(stakeId);
    return { valid: true, stakeId: validated };
  } catch (err) {
    if (err instanceof ZodError) {
      return { valid: false, error: err.errors[0]?.message || "Invalid Stake ID" };
    }
    return { valid: false, error: "Invalid Stake ID" };
  }
}
