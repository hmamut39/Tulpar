import 'package:flutter/material.dart';
import 'package:tulpar_flutter_material/spacing.dart';

class OrderCard extends StatelessWidget {
  const OrderCard({super.key, this.title = 'Order summary', this.summary = 'Two items, ready to ship.'});

  /// The card's heading.
  final String title;

  /// One line about the order.
  final String summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      identifier: '900:1',
      container: true,
      child: ColoredBox(
        color: scheme.surface,
        child: Padding(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                identifier: '900:2',
                child: Text(title, style: theme.textTheme.titleLarge?.copyWith(color: scheme.onSurface)),
              ),
              const SizedBox(height: Space.sm),
              Semantics(
                identifier: '900:3',
                child: Text(summary, style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
