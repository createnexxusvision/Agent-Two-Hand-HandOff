/**
 * AG Studio theme for the ledger. Every value is one of the site's CSS tokens (app/globals.css), so
 * Studio, its grids and charts follow the same light and dark palettes as the rest of the demo,
 * including the colour code: amber when an AI model acted, blue when plain code did, green for
 * verified or paid, red for blocked or broken. Series take the palette in order (green, blue, amber,
 * grey, red, purple), so stacked money charts list paid, committed, held and remaining in that order.
 */
import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

const palette = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${(i % 6) + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${(i % 6) + 1}`)],
  ]).flat(),
);

export const handoffTheme = studioTheme.withParams({
  fontFamily: token("sans"),
  fontSize: 14,
  textColor: token("fg"),
  foregroundColor: token("fg"),
  subtleTextColor: token("muted"),
  backgroundColor: token("card"),
  borderColor: token("line"),
  accentColor: token("accent"),
  iconColor: token("muted"),
  rowHoverColor: token("hover"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("bg"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("bg"),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token("sans"),

  // Widgets are the site's cards: 1px border, 12px radius.
  studioWidgetBackgroundColor: token("card"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 12,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: token("sans"),
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token("fg"),
  studioWidgetSubtitleFontFamily: token("sans"),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: token("sans"),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("accent"),

  studioPanelContainerBackgroundColor: token("card"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("accent"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: token("sans"),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("hover"),
  studioPanelChevronButtonHoverColor: token("accent"),
  studioToggleButtonActiveBackgroundColor: token("hover"),
  studioToggleButtonActiveBorderColor: token("accent"),
  studioToggleButtonActiveColor: token("accent"),

  // Grids read like the receipt tables on the home page: mono uppercase headers, tabular numbers.
  gridFontFamily: token("sans"),
  gridFontSize: 13,
  gridCellTextColor: token("fg"),
  gridHeaderBackgroundColor: token("card"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontFamily: token("mono"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 11,
  gridRowHeight: 36,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: token("hover"),
  gridWrapperBorder: false,

  chartFontFamily: token("sans"),
  chartTextColor: token("fg"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("line"),
  chartGridLineColor: token("line"),
  ...palette,
});
