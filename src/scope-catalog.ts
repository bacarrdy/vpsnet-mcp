// Generated from backend app/Services/Mcp/scope-catalog.json.
// Update with scripts/sync-scope-catalog.py; OAuth policy is enforced separately.
export const scopeCatalog: Record<string, { label: Record<string, string>; description: Record<string, string>; implies: string[]; billing: string; legacy: boolean }> = {
  "services:read": {
    "label": {
      "en": "View selected servers",
      "lt": "Peržiūrėti pasirinktus serverius"
    },
    "description": {
      "en": "View selected servers, status, graphs, history, backups and snapshots; browsing backup files may queue a saved browse operation.",
      "lt": "Peržiūrėti pasirinktus serverius, būseną, grafikus, istoriją, atsargines ir momentines kopijas; kopijų failų naršymas gali sukurti išsaugomą užduotį."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "services:manage": {
    "label": {
      "en": "Manage selected servers",
      "lt": "Valdyti pasirinktus serverius"
    },
    "description": {
      "en": "Start, stop or restart selected servers and change their settings, including guest DNS and firewall reset. Includes viewing selected servers.",
      "lt": "Paleisti, stabdyti ar perkrauti pasirinktus serverius ir keisti jų nustatymus, įskaitant DNS bei ugniasienės atkūrimą. Apima serverių peržiūrą."
    },
    "implies": [
      "services:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "applications:read": {
    "label": {
      "en": "View selected server applications",
      "lt": "Peržiūrėti pasirinktų serverių programas"
    },
    "description": {
      "en": "View applications, recipes, health and logs on selected servers; diagnostics may start saved inspection jobs.",
      "lt": "Peržiūrėti pasirinktų serverių programas, receptus, būseną ir žurnalus; diagnostika gali paleisti išsaugomas patikros užduotis."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "applications:manage": {
    "label": {
      "en": "Manage selected server applications",
      "lt": "Valdyti pasirinktų serverių programas"
    },
    "description": {
      "en": "Install, configure, update, stop, remove or roll back applications and recipes on selected servers. May replace or delete application data. Includes application viewing.",
      "lt": "Diegti, konfigūruoti, atnaujinti, stabdyti, šalinti ar atkurti pasirinktų serverių programas ir receptus. Gali pakeisti ar ištrinti programų duomenis. Apima programų peržiūrą."
    },
    "implies": [
      "applications:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "networking:read": {
    "label": {
      "en": "View account networks",
      "lt": "Peržiūrėti paskyros tinklus"
    },
    "description": {
      "en": "View existing networks, attachments, routes and network appliance status across your account.",
      "lt": "Peržiūrėti esamus paskyros tinklus, jungtis, maršrutus ir tinklo įrenginių būseną."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "networking:manage": {
    "label": {
      "en": "Manage account networks",
      "lt": "Valdyti paskyros tinklus"
    },
    "description": {
      "en": "Create, change or remove existing-account networks, routes, attachments and appliances. May interrupt connectivity. Includes network viewing; excludes purchases and renewals.",
      "lt": "Kurti, keisti ar šalinti paskyros tinklus, maršrutus, jungtis ir įrenginius. Gali sutrikdyti ryšį. Apima tinklų peržiūrą; pirkimai ir pratęsimai neįtraukti."
    },
    "implies": [
      "networking:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "functions:read": {
    "label": {
      "en": "View Functions and run results",
      "lt": "Peržiūrėti Functions ir vykdymo rezultatus"
    },
    "description": {
      "en": "View account Functions, their configuration, history and invocation results.",
      "lt": "Peržiūrėti paskyros Functions, jų konfigūraciją, istoriją ir vykdymo rezultatus."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "functions:manage": {
    "label": {
      "en": "Manage Functions",
      "lt": "Valdyti Functions"
    },
    "description": {
      "en": "Create, update or delete account Functions and their code. Includes viewing Functions; running them requires separate paid execution permission.",
      "lt": "Kurti, atnaujinti ar trinti paskyros Functions ir jų kodą. Apima Functions peržiūrą; vykdymui reikia atskiro mokamo vykdymo leidimo."
    },
    "implies": [
      "functions:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "functions:invoke": {
    "label": {
      "en": "Run Functions (usage charges)",
      "lt": "Vykdyti Functions (mokama pagal naudojimą)"
    },
    "description": {
      "en": "Run existing account Functions using your VPSnet balance. Usage charges apply; your AI subscription does not cover them. Includes viewing Functions and run results. The daily limit counts total account Functions spending, including pending runs.",
      "lt": "Vykdyti paskyros Functions naudojant VPSnet balansą. Taikomi naudojimo mokesčiai; AI prenumerata jų nepadengia. Apima Functions ir rezultatų peržiūrą. Dienos riba apima visas paskyros Functions išlaidas, įskaitant laukiančius vykdymus."
    },
    "implies": [
      "functions:read"
    ],
    "billing": "usage_balance",
    "legacy": false
  },
  "vm:diagnostics": {
    "label": {
      "en": "Inspect selected servers",
      "lt": "Tikrinti pasirinktus serverius"
    },
    "description": {
      "en": "Run bounded diagnostics on selected servers and save operation results. Does not grant arbitrary commands or file access.",
      "lt": "Vykdyti ribotą pasirinktų serverių diagnostiką ir išsaugoti rezultatus. Nesuteikia savavališkų komandų ar failų prieigos."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "vm:files:read": {
    "label": {
      "en": "Read selected server files as root",
      "lt": "Skaityti pasirinktų serverių failus root teisėmis"
    },
    "description": {
      "en": "Read files on selected servers with root privileges through saved guest operations. Files may contain secrets.",
      "lt": "Skaityti pasirinktų serverių failus root teisėmis per išsaugomas užduotis. Failuose gali būti paslapčių."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "vm:files:write": {
    "label": {
      "en": "Read and change selected server files as root",
      "lt": "Skaityti ir keisti pasirinktų serverių failus root teisėmis"
    },
    "description": {
      "en": "Create or overwrite files on selected servers with root privileges. Includes reading files; changes can replace data or affect server operation.",
      "lt": "Kurti ar perrašyti pasirinktų serverių failus root teisėmis. Apima failų skaitymą; pakeitimai gali pakeisti duomenis ar paveikti serverio veikimą."
    },
    "implies": [
      "vm:files:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "vm:exec": {
    "label": {
      "en": "Run selected server commands as root",
      "lt": "Vykdyti pasirinktų serverių komandas root teisėmis"
    },
    "description": {
      "en": "Run arbitrary commands and install root SSH access on selected servers. Can read, change or delete data through commands. Includes bounded server diagnostics.",
      "lt": "Vykdyti savavališkas komandas ir įdiegti root SSH prieigą pasirinktuose serveriuose. Komandos gali skaityti, keisti ar trinti duomenis. Apima ribotą serverių diagnostiką."
    },
    "implies": [
      "vm:diagnostics"
    ],
    "billing": "none",
    "legacy": false
  },
  "vm:files": {
    "label": {
      "en": "Read and change selected server files as root (legacy)",
      "lt": "Skaityti ir keisti pasirinktų serverių failus root teisėmis (senasis leidimas)"
    },
    "description": {
      "en": "Legacy combined file permission: includes vm:files:read and vm:files:write on selected servers. Can read secrets and overwrite data. Not advertised for new connections.",
      "lt": "Senasis jungtinis failų leidimas: apima vm:files:read ir vm:files:write pasirinktuose serveriuose. Gali skaityti paslaptis ir perrašyti duomenis. Naujiems prisijungimams neskelbiamas."
    },
    "implies": [
      "vm:files:read",
      "vm:files:write"
    ],
    "billing": "none",
    "legacy": true
  },
  "services:reinstall": {
    "label": {
      "en": "Reinstall selected server operating systems",
      "lt": "Perdiegti pasirinktų serverių operacines sistemas"
    },
    "description": {
      "en": "Reinstall operating systems on selected servers. This can erase existing server data.",
      "lt": "Perdiegti pasirinktų serverių operacines sistemas. Tai gali ištrinti esamus serverio duomenis."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "services:restore": {
    "label": {
      "en": "Restore or delete selected server snapshots",
      "lt": "Atkurti arba trinti pasirinktų serverių momentines kopijas"
    },
    "description": {
      "en": "Restore selected servers from snapshots or delete snapshots. Restoring replaces current data; deleting removes a recovery point.",
      "lt": "Atkurti pasirinktus serverius iš momentinių kopijų arba trinti kopijas. Atkūrimas pakeičia esamus duomenis; ištrynus kopiją prarandamas atkūrimo taškas."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "services:rescue": {
    "label": {
      "en": "Start or exit selected server rescue mode",
      "lt": "Įjungti ar išjungti pasirinktų serverių atkūrimo režimą"
    },
    "description": {
      "en": "Start or exit rescue mode on selected servers. May restart a server or interrupt its workload. Includes viewing selected servers.",
      "lt": "Įjungti ar išjungti pasirinktų serverių atkūrimo režimą. Gali perkrauti serverį ar nutraukti jo darbą. Apima serverių peržiūrą."
    },
    "implies": [
      "services:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "dns:read": {
    "label": {
      "en": "View account DNS",
      "lt": "Peržiūrėti paskyros DNS"
    },
    "description": {
      "en": "View account DNS zones, records, diagnostics, DNSSEC state and zone history.",
      "lt": "Peržiūrėti paskyros DNS zonas, įrašus, diagnostiką, DNSSEC būseną ir zonų istoriją."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "dns:write": {
    "label": {
      "en": "Manage account DNS",
      "lt": "Valdyti paskyros DNS"
    },
    "description": {
      "en": "Create, change, import or delete account DNS zones and records. Can redirect traffic or interrupt domains. Includes DNS viewing.",
      "lt": "Kurti, keisti, importuoti ar trinti paskyros DNS zonas ir įrašus. Gali nukreipti srautą ar sutrikdyti domenų veikimą. Apima DNS peržiūrą."
    },
    "implies": [
      "dns:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "dnssec:manage": {
    "label": {
      "en": "Manage account DNSSEC",
      "lt": "Valdyti paskyros DNSSEC"
    },
    "description": {
      "en": "Change DNSSEC signing for account DNS zones. Incorrect changes can interrupt DNS resolution. Includes DNS viewing.",
      "lt": "Keisti paskyros DNS zonų DNSSEC pasirašymą. Klaidingi pakeitimai gali sutrikdyti DNS veikimą. Apima DNS peržiūrą."
    },
    "implies": [
      "dns:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "domains:read": {
    "label": {
      "en": "View account domains",
      "lt": "Peržiūrėti paskyros domenus"
    },
    "description": {
      "en": "View account domains, nameservers, glue records, parent DS records and contacts.",
      "lt": "Peržiūrėti paskyros domenus, vardų serverius, glue ir tėvinės zonos DS įrašus bei kontaktus."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "domains:manage": {
    "label": {
      "en": "Manage account domains",
      "lt": "Valdyti paskyros domenus"
    },
    "description": {
      "en": "Change account domain nameservers, glue records, parent DS records and contacts. Can interrupt domain resolution. Includes domain viewing; registration requires separate purchase permission.",
      "lt": "Keisti paskyros domenų vardų serverius, glue ir tėvinės zonos DS įrašus bei kontaktus. Gali sutrikdyti domenų veikimą. Apima peržiūrą; registravimui reikia atskiro pirkimo leidimo."
    },
    "implies": [
      "domains:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "certificates:read": {
    "label": {
      "en": "View account TLS certificates",
      "lt": "Peržiūrėti paskyros TLS sertifikatus"
    },
    "description": {
      "en": "View account TLS certificates, validation and actions, and download available certificate material.",
      "lt": "Peržiūrėti paskyros TLS sertifikatus, patvirtinimą, veiksmus ir atsisiųsti prieinamą sertifikatų medžiagą."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "certificates:manage": {
    "label": {
      "en": "Manage account TLS certificates",
      "lt": "Valdyti paskyros TLS sertifikatus"
    },
    "description": {
      "en": "Create or renew free certificates and manage existing certificates and automatic SSL subscriptions, including cancellation or revocation. Includes certificate viewing; excludes purchases.",
      "lt": "Kurti ar pratęsti nemokamus sertifikatus ir valdyti esamus sertifikatus bei automatinio SSL prenumeratas, įskaitant atšaukimą. Apima sertifikatų peržiūrą; pirkimai neįtraukti."
    },
    "implies": [
      "certificates:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "ssh_keys:read": {
    "label": {
      "en": "View account public SSH keys",
      "lt": "Peržiūrėti paskyros viešuosius SSH raktus"
    },
    "description": {
      "en": "View public SSH keys saved in your account. Does not expose private keys.",
      "lt": "Peržiūrėti paskyroje išsaugotus viešuosius SSH raktus. Privatūs raktai neatskleidžiami."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "ssh_keys:manage": {
    "label": {
      "en": "Manage account public SSH keys",
      "lt": "Valdyti paskyros viešuosius SSH raktus"
    },
    "description": {
      "en": "Add or delete account public SSH keys. Includes key viewing; installing a key on a server requires vm:exec permission.",
      "lt": "Pridėti ar trinti paskyros viešuosius SSH raktus. Apima raktų peržiūrą; diegimui serveryje reikia vm:exec leidimo."
    },
    "implies": [
      "ssh_keys:read"
    ],
    "billing": "none",
    "legacy": false
  },
  "orders:read": {
    "label": {
      "en": "View server plans and server or domain purchase results",
      "lt": "Peržiūrėti serverių planus ir serverių ar domenų pirkimo rezultatus"
    },
    "description": {
      "en": "View server plans, order options and existing server or domain purchase results. Does not submit a purchase. Available only through the separate orders profile.",
      "lt": "Peržiūrėti serverių planus, užsakymo parinktis ir esamų serverių ar domenų pirkimų rezultatus. Pirkimo neatlieka. Prieinama tik atskirame užsakymų profilyje."
    },
    "implies": [],
    "billing": "none",
    "legacy": false
  },
  "orders:servers": {
    "label": {
      "en": "Purchase VPS servers from your balance",
      "lt": "Pirkti VPS serverius iš balanso"
    },
    "description": {
      "en": "Quote and purchase VPS servers using your VPSnet balance after approval of the final gross EUR amount and period, within this connection’s daily and monthly limits. Includes viewing order plans and purchase results. Available only through the separate orders profile.",
      "lt": "Gauti VPS serverių pasiūlymus ir pirkti iš VPSnet balanso, patvirtinus galutinę EUR sumą su mokesčiais bei laikotarpį, neviršijant jungties dienos ir mėnesio ribų. Apima planų ir pirkimų rezultatų peržiūrą. Prieinama tik atskirame užsakymų profilyje."
    },
    "implies": [
      "orders:read"
    ],
    "billing": "purchase_balance",
    "legacy": false
  },
  "orders:domains": {
    "label": {
      "en": "Register domains from your balance",
      "lt": "Registruoti domenus iš balanso"
    },
    "description": {
      "en": "Quote and register domains using your VPSnet balance after approval of the final gross EUR amount and period, within this connection’s daily and monthly limits. Registration may be non-refundable. Includes viewing order plans and purchase results. Available only through the separate orders profile.",
      "lt": "Gauti domenų pasiūlymus ir registruoti iš VPSnet balanso, patvirtinus galutinę EUR sumą su mokesčiais bei laikotarpį, neviršijant jungties dienos ir mėnesio ribų. Registravimo mokestis gali būti negrąžinamas. Apima planų ir pirkimų rezultatų peržiūrą. Prieinama tik atskirame užsakymų profilyje."
    },
    "implies": [
      "orders:read"
    ],
    "billing": "purchase_balance",
    "legacy": false
  }
};

export function scopeDescriptions(scopes: readonly string[]): Record<string, string> {
  return Object.fromEntries(scopes.map(scope => [scope, scopeCatalog[scope].description.en]));
}
