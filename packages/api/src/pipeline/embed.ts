const MODEL = "nvidia/nv-embedqa-e5-v5";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/embeddings";
const DIMENSIONS = 1024;

export type InputType = "passage" | "query";

export async function embed(
  apiKey: string,
  text: string,
  inputType: InputType = "passage",
): Promise<number[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: text,
      input_type: inputType,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`embed_http_${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data.data?.[0]?.embedding;
  if (!vec || vec.length !== DIMENSIONS) {
    throw new Error(`embed_bad_shape: expected ${DIMENSIONS} dims, got ${vec?.length}`);
  }
  return vec;
}
