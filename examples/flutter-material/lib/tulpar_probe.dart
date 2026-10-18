// Tulpar's token probe: reads the theme's colour roles and type scale where Flutter computes them,
// at run time in the browser, and hands them to the page as JSON (window.tulparTokens).
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';

void main() => runApp(MaterialApp(theme: ThemeData(useMaterial3: true), home: const Probe()));

class Probe extends StatelessWidget {
  const Probe({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = theme.colorScheme;
    final colors = <String, Color>{
      'primary': c.primary, 'onPrimary': c.onPrimary, 'primaryContainer': c.primaryContainer, 'onPrimaryContainer': c.onPrimaryContainer,
      'secondary': c.secondary, 'onSecondary': c.onSecondary, 'secondaryContainer': c.secondaryContainer, 'onSecondaryContainer': c.onSecondaryContainer,
      'tertiary': c.tertiary, 'onTertiary': c.onTertiary, 'tertiaryContainer': c.tertiaryContainer, 'onTertiaryContainer': c.onTertiaryContainer,
      'error': c.error, 'onError': c.onError, 'errorContainer': c.errorContainer, 'onErrorContainer': c.onErrorContainer,
      'surface': c.surface, 'onSurface': c.onSurface, 'onSurfaceVariant': c.onSurfaceVariant,
      'surfaceContainerLowest': c.surfaceContainerLowest, 'surfaceContainerLow': c.surfaceContainerLow, 'surfaceContainer': c.surfaceContainer,
      'surfaceContainerHigh': c.surfaceContainerHigh, 'surfaceContainerHighest': c.surfaceContainerHighest,
      'outline': c.outline, 'outlineVariant': c.outlineVariant, 'inverseSurface': c.inverseSurface, 'onInverseSurface': c.onInverseSurface,
      'inversePrimary': c.inversePrimary, 'shadow': c.shadow, 'scrim': c.scrim,
    };
    final t = theme.textTheme;
    final styles = <String, TextStyle?>{
      'displayLarge': t.displayLarge, 'displayMedium': t.displayMedium, 'displaySmall': t.displaySmall,
      'headlineLarge': t.headlineLarge, 'headlineMedium': t.headlineMedium, 'headlineSmall': t.headlineSmall,
      'titleLarge': t.titleLarge, 'titleMedium': t.titleMedium, 'titleSmall': t.titleSmall,
      'bodyLarge': t.bodyLarge, 'bodyMedium': t.bodyMedium, 'bodySmall': t.bodySmall,
      'labelLarge': t.labelLarge, 'labelMedium': t.labelMedium, 'labelSmall': t.labelSmall,
    };
    globalContext['tulparTokens'] = jsonEncode({
      'colors': {for (final e in colors.entries) e.key: e.value.toARGB32()},
      'text': {
        for (final e in styles.entries)
          if (e.value != null)
            e.key: {'fontSize': e.value!.fontSize, 'fontWeight': e.value!.fontWeight?.value, 'height': e.value!.height, 'letterSpacing': e.value!.letterSpacing, 'fontFamily': e.value!.fontFamily},
      },
    }).toJS;
    return const SizedBox.shrink();
  }
}
