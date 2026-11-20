import { within } from "@testing-library/react";

// A ui/DateField takes digits segment by segment, in its yyyy-mm-dd order.
export async function typeDate(user, field, iso) {
  await user.click(within(field).getAllByRole("spinbutton")[0]);
  await user.keyboard(iso.replaceAll("-", ""));
}
