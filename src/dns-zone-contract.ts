/** Describes both creation paths in DnsZonesController::store, including restoration. */
export function createDnsZoneDescription(hosted = false): string {
  return [
    hosted
      ? "Create a native forward DNS zone in the connected VPSnet account. Secondary zones and their TSIG credentials must be configured in the VPSnet control panel; this hosted tool does not accept authentication secrets."
      : "Create a native or secondary forward DNS zone in the authenticated VPSnet account. Secondary zones transfer records from public primary DNS servers and require TSIG.",
    "Normally creates pending_verification. With qualifying current ownership proof, the API may instead restore a recently deleted zone and queue immediate publication. Publication can delete stale zone candidates for the same name, including their DNS records and DDNS tokens. Existing live zones are refused; this does not register a domain or change registrar nameservers.",
    "Read the returned zone.status and apply_state: queued publication is not proof of live DNS service. When verification is needed, verificationRecord contains the public ownership TXT challenge (_vpsnet-dns.<zone>). Follow zone.verification.next_step and warnings for its location, then call verify_dns_zone. Keep nameservers already delegated to VPSnet. A previous-provider or parent-zone location may be required.",
    "If the TXT value is missing, first read get_dns_zone.zone.verification.record.value; reissue_dns_zone_verification rotates it only when unrecoverable or requested by the customer. Requires dns:write.",
  ].join(" ");
}
