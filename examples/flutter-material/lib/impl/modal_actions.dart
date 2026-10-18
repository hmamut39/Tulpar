// Reference implementation of Figma "_Modal footer item", variant "Actions=2" (node 3906:50588),
// in Material 3: two actions sharing the footer's width. Hand-written, so the verifier has a baseline.
import 'package:flutter/material.dart';

class ModalActions extends StatelessWidget {
  const ModalActions({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      identifier: '3906:50588',
      container: true,
      child: ColoredBox(
        color: scheme.inverseSurface,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Semantics(
                identifier: '4122:87677',
                child: OutlinedButton(onPressed: () {}, child: const Text('Button')),
              ),
            ),
            Expanded(
              child: Semantics(
                identifier: '4122:86445',
                child: FilledButton(onPressed: () {}, child: const Text('Button')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
