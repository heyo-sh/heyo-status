import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Provide local Worker bindings to Next's dev server as well as the deployed Worker.
void initOpenNextCloudflareForDev();

/** @type {import("next").NextConfig} */
export default {};
