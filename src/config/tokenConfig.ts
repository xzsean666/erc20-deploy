import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getAddress, parseUnits } from "ethers";
import { z } from "zod";

const envNameSchema = z
  .string()
  .regex(
    /^[A-Z_][A-Z0-9_]*$/,
    "must be an environment variable name like DEPLOYER_PRIVATE_KEY"
  );

const decimalStringSchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]*)(\.[0-9]+)?$/,
    "must be a non-negative decimal string without exponent notation"
  );

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte hex address")
  .refine(
    (value) => {
      try {
        getAddress(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "must be a valid Ethereum address" }
  )
  .transform((value) => getAddress(value));

const rpcSchema = z
  .string()
  .url("must be a valid HTTP(S) RPC URL")
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: "must use http or https protocol" }
  );

const gasSchema = z
  .object({
    maxFeePerGasGwei: decimalStringSchema.optional(),
    maxPriorityFeePerGasGwei: decimalStringSchema.optional(),
  })
  .strict()
  .default({});

const verifySchema = z
  .object({
    enabled: z.boolean().default(false),
    explorer: z.enum(["etherscan", "blockscout"]).optional(),
    apiKeyEnv: envNameSchema.optional(),
  })
  .strict()
  .default({ enabled: false });

const metadataSchema = z
  .object({
    project: z.string().max(80).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict()
  .default({});

export const tokenConfigSchema = z
  .object({
    rpc: rpcSchema,
    chainId: z.number().int().positive().safe(),
    deployerPrivateKeyEnv: envNameSchema,
    tokenName: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value.trim().length > 0, {
        message: "must not be blank",
      }),
    symbol: z
      .string()
      .min(1)
      .max(20)
      .regex(
        /^[A-Za-z0-9_.$-]+$/,
        "must contain only letters, numbers, _, ., $, or -"
      ),
    decimals: z.number().int().min(0).max(18),
    initialSupply: decimalStringSchema,
    initialRecipient: addressSchema.optional(),
    owner: addressSchema.optional(),
    isTest: z.boolean(),
    isUpgradeable: z.boolean(),
    confirmations: z.number().int().min(0).default(2),
    gas: gasSchema,
    verify: verifySchema,
    metadata: metadataSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const fractionalDigits = value.initialSupply.includes(".")
      ? value.initialSupply.split(".")[1].length
      : 0;

    if (fractionalDigits > value.decimals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initialSupply"],
        message: `has ${fractionalDigits} decimal places, but decimals is ${value.decimals}`,
      });
    } else {
      try {
        parseUnits(value.initialSupply, value.decimals);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["initialSupply"],
          message:
            error instanceof Error
              ? error.message
              : "cannot be converted to base units",
        });
      }
    }

    validateGweiField(
      value.gas.maxFeePerGasGwei,
      ["gas", "maxFeePerGasGwei"],
      ctx
    );
    validateGweiField(
      value.gas.maxPriorityFeePerGasGwei,
      ["gas", "maxPriorityFeePerGasGwei"],
      ctx
    );
  });

export type RawTokenConfig = z.input<typeof tokenConfigSchema>;
export type TokenConfig = z.infer<typeof tokenConfigSchema>;

export async function loadTokenConfig(
  configPath: string
): Promise<TokenConfig> {
  const absolutePath = resolve(configPath);
  let raw: string;

  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read token config at ${absolutePath}: ${message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid JSON in token config at ${absolutePath}: ${message}`
    );
  }

  const result = tokenConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid token config at ${absolutePath}:\n${formatZodIssues(
        result.error
      )}`
    );
  }

  return result.data;
}

function validateGweiField(
  value: string | undefined,
  path: Array<string>,
  ctx: z.RefinementCtx
): void {
  if (value === undefined) {
    return;
  }

  const fractionalDigits = value.includes(".") ? value.split(".")[1].length : 0;
  if (fractionalDigits > 9) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "must not have more than 9 decimal places for gwei values",
    });
  }
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}
