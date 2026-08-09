export type RenderedEmail = Readonly<{
  subject: string;
  html: string;
  text: string;
  templateCode: string;
  templateVersion: number;
}>;

export interface EmailTemplateRendererPort {
  render(templateCode: string, context: Readonly<Record<string, unknown>>): Promise<RenderedEmail>;
}
