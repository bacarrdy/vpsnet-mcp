export class RemoteAuthError extends Error {
  constructor(public readonly kind: 'invalid_token' | 'insufficient_scope', public readonly scope?: string) {
    super(kind === 'invalid_token' ? 'The connection has expired or was revoked. Re-authorize this existing VPSnet connection in your AI app.' : `This action requires ${scope || 'an additional permission'}. Ask the customer to approve this permission by re-authorizing this existing VPSnet connection in their AI app.`);
  }
  result() {
    const challenge = `Bearer error="${this.kind}", error_description="${this.message}"${this.scope ? `, scope="${this.scope}"` : ''}`;
    return { isError: true, content: [{ type: 'text' as const, text: this.message }], _meta: { 'mcp/www_authenticate': [challenge] } };
  }
}
