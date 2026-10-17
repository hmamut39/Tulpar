// A component written with the design system only: the Tulpar check Action's self-test passes on it.
import { Button, Flex } from "@radix-ui/themes";

export default function Clean() {
  return (
    <Flex gap="3">
      <Button size="2">Save</Button>
    </Flex>
  );
}
