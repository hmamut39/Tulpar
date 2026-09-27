// Reference implementation of Figma "_Modal footer item", variant
// "Actions=2, Cancel=False, Inline loading=False" (node 3906:50588), in Carbon React.
// Hand-written, so the verifier has a known-good baseline to mutate.
import { Button, ModalFooter } from "@carbon/react";

export default function Implementation() {
  return (
    <ModalFooter data-figma-id="3906:50588">
      <Button kind="secondary" data-figma-id="4122:87677">
        Button
      </Button>
      <Button kind="primary" data-figma-id="4122:86445">
        Button
      </Button>
    </ModalFooter>
  );
}
