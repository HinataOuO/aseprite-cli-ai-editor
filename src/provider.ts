export interface ProviderRequest {
  intent?: string;
  cropPngBase64?: string;
  mask?: unknown;
  palette?: unknown;
  errors?: string[];
  previousDiff?: unknown;
}
export interface Provider { readonly model: string; readonly version: string; generate(request: ProviderRequest): Promise<unknown> }

export interface OpenAICompatibleOptions { baseUrl: string; model: string; apiKey?: string; version?: string; cloudConsent?: boolean }

export class OpenAICompatibleProvider implements Provider {
  readonly model: string;
  readonly version: string;
  private readonly endpoint: URL;
  constructor(private readonly options: OpenAICompatibleOptions) {
    this.model=options.model; this.version=options.version ?? "unknown";
    this.endpoint=new URL("chat/completions", options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    const local=["localhost","127.0.0.1","::1"].includes(this.endpoint.hostname);
    if (!local && !options.cloudConsent && process.env.AI_EDITOR_CLOUD_CONSENT!=="1") throw new Error("cloud provider requires explicit consent");
  }
  async generate(request: ProviderRequest): Promise<unknown> {
    const response=await fetch(this.endpoint,{method:"POST",headers:{"content-type":"application/json",...(this.options.apiKey ? {authorization:`Bearer ${this.options.apiKey}`} : {})},body:JSON.stringify({model:this.model,response_format:{type:"json_object"},messages:[{role:"system",content:"Return only a JSON Candidate using palette indices or -1."},{role:"user",content:JSON.stringify(request)}]})});
    if (!response.ok) throw new Error(`provider_unavailable: HTTP ${response.status}`);
    const body=await response.json() as { choices?: { message?: { content?: string } }[] };
    const content=body.choices?.[0]?.message?.content;
    if (!content) throw new Error("provider_unavailable: empty response");
    try { return JSON.parse(content); } catch { throw new Error("validation_failed: provider returned invalid JSON"); }
  }
}

export class FakeProvider implements Provider {
  readonly model="fake"; readonly version="1";
  requests: ProviderRequest[]=[];
  constructor(private readonly outputs: unknown[]) {}
  async generate(request: ProviderRequest): Promise<unknown> {
    this.requests.push(structuredClone(request));
    if (!this.outputs.length) throw new Error("provider_unavailable");
    const output=this.outputs.shift(); if (output instanceof Error) throw output; return structuredClone(output);
  }
}
