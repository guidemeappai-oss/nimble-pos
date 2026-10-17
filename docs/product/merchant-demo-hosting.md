# Hosted merchant demonstration

The interactive frontend snapshot is hosted separately from the full application. It mounts only MerchantDemo, with in-memory data and simulated payments. It does not deploy Fastify, PostgreSQL, wallet signing or the notification worker.

- Deployment succeeded: https://nimble-counter-demo.prouddell256.chatgpt.site
- Audience: owner-private.
- Site project: `appgprj_6ad01750b29c8191bb25f398069d731e`.
- Saved version: `appgprj_6ad01750b29c8191bb25f398069d731e~appgver_21d923e333448191852c38c2fb1d408d`.
- Deployment: `appgdep_6ad017a6769c81919dbe023e3aaa9338`.
- Source snapshot: `4661185ba8c3b1ce4c6399023f4b6b20f250d921`, derived from this application's `6f008cc`.
- Source checkout: `/workspace/sites/nimble-counter-demo`; preserve `.openai/hosting.json` and reuse its Site identity for updates.

The snapshot includes frontend/shared source and built static assets. Its entry mounts MerchantDemo through AppProvider/BrowserRouter and omits network detection and live setup links. A demo revision requires rebuilding and synchronizing this snapshot; changing this repository alone does not update the hosted demo.

The previous Chromium walkthrough tested the application's demo. The separate hosted entry passed the Vite production build; browser QA of this deployment was unavailable in the managed publishing environment.

For actual Android wallet testing, deploy the complete application with native PostgreSQL using the existing deploy configuration. That requires access to the target server and network-specific configuration; this static demonstration does not validate payment signing or background alerts.
