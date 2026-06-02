import { resolve } from "path";
import { runInoProShopCommand } from "./inoproshopRunner";

async function main() {
  const INOPROSHOP_EXE =
    process.env.INOPROSHOP_EXE ||
    "C:\\Inovance Control\\InoProShop\\CODESYS\\Common\\InoProShop.exe";

  const INOPROSHOP_PROFILE =
    process.env.INOPROSHOP_PROFILE || "InoProShop(V1.9.1.6)";

  const PROJECT_PATH =
    process.env.INOPROSHOP_PROJECT ||
    "C:\\Users\\kaykov\\Desktop\\Avanpost\\PLC\\PLC.project";

  const ADAPTER_TEMPLATE = resolve("scripts/sp11_adapter_template.py");

  const result = await runInoProShopCommand(
    {
      action: "read_object",
      project_path: PROJECT_PATH,
      object_name: "Pump",
      include_text: false,
    },
    {
      inoproshopExe: INOPROSHOP_EXE,
      profile: INOPROSHOP_PROFILE,
      adapterTemplatePath: ADAPTER_TEMPLATE,
      timeoutMs: 180000,
    }
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});