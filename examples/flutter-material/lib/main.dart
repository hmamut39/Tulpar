// Tulpar's harness: shows one widget at the Figma frame's size, with semantics on, so each
// Semantics(identifier:) becomes a positioned element in the page that the render can measure.
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import 'impl/modal_actions.dart';

const double frameWidth = int.fromEnvironment('FRAME_WIDTH', defaultValue: 640) / 1;
const double frameHeight = int.fromEnvironment('FRAME_HEIGHT', defaultValue: 64) / 1;

void main() {
  runApp(const Harness());
  SemanticsBinding.instance.ensureSemantics();
}

class Harness extends StatelessWidget {
  const Harness({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true),
      home: const Scaffold(
        body: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(width: frameWidth, height: frameHeight, child: ModalActions()),
        ),
      ),
    );
  }
}
