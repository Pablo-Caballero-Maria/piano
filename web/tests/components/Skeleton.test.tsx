import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "@/components/ui/Skeleton";

describe("Skeleton", () => {
  it("is a pulsing block hidden from screen readers, sized by its caller", () => {
    const { container } = render(<Skeleton className="h-[52px]" />);
    const block = container.firstElementChild!;
    expect(block).toHaveAttribute("aria-hidden", "true");
    expect(block.className).toContain("animate-pulse");
    expect(block.className).toContain("h-[52px]");
  });
});
