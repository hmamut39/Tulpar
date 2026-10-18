// Reference implementation of Figma "_Modal footer item", variant "Actions=2" (node 3906:50588),
// in Material 3. Hand-written, so the verifier has a known-good baseline.
import 'package:flutter/material.dart';

class ModalActions extends StatelessWidget {
  const ModalActions({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      identifier: '3906:50588',
      container: true,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Semantics(
            identifier: '4122:87677',
            child: OutlinedButton(onPressed: () {}, child: const Text('Cancel')),
          ),
          const SizedBox(width: 8),
          Semantics(
            identifier: '4122:86445',
            child: FilledButton(onPressed: () {}, child: const Text('Save')),
          ),
        ],
      ),
    );
  }
}
