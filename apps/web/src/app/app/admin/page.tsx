import { Suspense } from "react";
import { RolePlaceholder } from "@/features/shell/RolePlaceholder";

export default function AdminPage() {
  return (
    <Suspense>
      <RolePlaceholder allowed={["gym_admin", "platform_admin"]} title="Gym admin" />
    </Suspense>
  );
}
