import { Suspense } from "react";
import { RolePlaceholder } from "@/features/shell/RolePlaceholder";

export default function TrainerPage() {
  return (
    <Suspense>
      <RolePlaceholder allowed={["trainer", "gym_admin", "platform_admin"]} title="My members" />
    </Suspense>
  );
}
