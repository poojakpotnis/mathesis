import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export type PdfProblem = {
  displayOrder: number;
  problemText: string;
  problemLatex: string | null;
  // PNG data URI of the rasterized figure SVG (react-pdf can't embed raw SVG),
  // or null. Rasterized in the PDF route via ../rasterize.ts.
  figurePng: string | null;
  correctAnswer: string;
  answerFormatType: string;
  solutionSteps: string | null;
  verificationStatus: "verified" | "flagged" | "approved" | "confirmed_flagged";
};

export type PdfWorksheet = {
  id: number;
  title: string;
  lessonTitle: string;
  lessonNumber: number;
  createdAt: string;
  problems: PdfProblem[];
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 56,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#d4d4d4",
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: "Times-Roman",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: "#666",
  },
  sectionLabel: {
    fontSize: 10,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  problemRow: {
    flexDirection: "row",
    marginBottom: 18,
  },
  problemNumber: {
    width: 28,
    fontWeight: "bold",
    fontFamily: "Times-Roman",
  },
  problemBody: {
    flex: 1,
  },
  problemText: {
    lineHeight: 1.5,
  },
  figure: {
    marginTop: 8,
    width: 220,
    objectFit: "contain",
  },
  answerLine: {
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#9ca3af",
    borderBottomStyle: "dashed",
    height: 18,
  },
  answerLabel: {
    fontSize: 9,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginRight: 4,
  },
  answer: {
    fontWeight: "bold",
    marginTop: 6,
  },
  solution: {
    marginTop: 6,
    fontSize: 10,
    color: "#444",
    lineHeight: 1.4,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: "#d4d4d4",
  },
  flag: {
    marginTop: 4,
    fontSize: 9,
    color: "#a16207",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 56,
    right: 56,
    fontSize: 9,
    color: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function preferredText(p: PdfProblem): string {
  // react-pdf has no math typesetter, so use the plain-text form. problemLatex
  // is kept in the DB for a future Typst/KaTeX pipeline (Phase 6+).
  return p.problemText;
}

export function WorksheetPdf({ worksheet }: { worksheet: PdfWorksheet }) {
  const created = new Date(worksheet.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <Document title={worksheet.title}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{worksheet.title}</Text>
          <Text style={styles.subtitle}>
            Worksheet #{worksheet.id} · {created}
          </Text>
        </View>
        <Text style={styles.sectionLabel}>Worksheet</Text>
        {worksheet.problems.map((p) => (
          <View key={`q-${p.displayOrder}`} style={styles.problemRow} wrap={false}>
            <Text style={styles.problemNumber}>{p.displayOrder}.</Text>
            <View style={styles.problemBody}>
              <Text style={styles.problemText}>{preferredText(p)}</Text>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not HTML img */}
              {p.figurePng && <Image style={styles.figure} src={p.figurePng} />}
              <View style={styles.answerLine} />
            </View>
          </View>
        ))}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Mathesis · ${worksheet.title}  ·  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{worksheet.title}</Text>
          <Text style={styles.subtitle}>
            Worksheet #{worksheet.id} · Answer key · {created}
          </Text>
        </View>
        <Text style={styles.sectionLabel}>Answer key</Text>
        {worksheet.problems.map((p) => (
          <View key={`a-${p.displayOrder}`} style={styles.problemRow} wrap={false}>
            <Text style={styles.problemNumber}>{p.displayOrder}.</Text>
            <View style={styles.problemBody}>
              <Text style={styles.problemText}>{preferredText(p)}</Text>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not HTML img */}
              {p.figurePng && <Image style={styles.figure} src={p.figurePng} />}
              <Text style={styles.answer}>
                <Text style={styles.answerLabel}>Answer </Text>
                {p.correctAnswer}
              </Text>
              {p.solutionSteps && (
                <Text style={styles.solution}>{p.solutionSteps}</Text>
              )}
              {(p.verificationStatus === "flagged" ||
                p.verificationStatus === "confirmed_flagged") && (
                <Text style={styles.flag}>
                  ⚠ Flagged — verifier disagreed with the generated answer.
                  Review before using.
                </Text>
              )}
            </View>
          </View>
        ))}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Mathesis · Answer key  ·  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
