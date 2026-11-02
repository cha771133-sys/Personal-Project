import fs from "node:fs";
import path from "node:path";

const filename = path.join(process.cwd(), "src", "app", "calendar", "page.tsx");
if (!fs.existsSync(filename)) {
  console.error("ERROR: Run this script from the Personal-Project repository root.");
  process.exit(1);
}
const oldText = fs.readFileSync(filename, "utf8");
const newImport = "import DeviceCalendarPanel from '@/components/DeviceCalendarPanel';";
const newPanel = "        {/* ESP32 / Redis: read-only server calendar */}\n        <DeviceCalendarPanel />\n\n";

if (oldText.includes(newImport) && oldText.includes("<DeviceCalendarPanel />")) {
  console.log("Already applied; calendar/page.tsx was not changed.");
  process.exit(0);
}
if (oldText.includes(newImport) || oldText.includes("<DeviceCalendarPanel />")) {
  console.error("ERROR: Partial previous installation detected. Please inspect calendar/page.tsx.");
  process.exit(1);
}
const anchorImport = "import BottomNav from '@/components/BottomNav';";
const anchorPanel = "        {/* 달력 */}";
if (oldText.split(anchorImport).length !== 2 || oldText.split(anchorPanel).length !== 2) {
  console.error("ERROR: Expected calendar markers not found. No files changed.");
  process.exit(1);
}
const updated = oldText
  .replace(anchorImport, `${anchorImport}\n${newImport}`)
  .replace(anchorPanel, `${newPanel}${anchorPanel}`);

const backup = `${filename}.before-device-calendar.bak`;
if (!fs.existsSync(backup)) fs.copyFileSync(filename, backup);
fs.writeFileSync(filename, updated, "utf8");
console.log("OK: Calendar panel installed in src/app/calendar/page.tsx");
console.log("Backup file created at src/app/calendar/page.tsx.before-device-calendar.bak");
