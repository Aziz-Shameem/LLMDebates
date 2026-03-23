"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamDebatePdf = streamDebatePdf;
const pdfkit_1 = __importDefault(require("pdfkit"));
function choiceToLetter(choiceIndex) {
    return String.fromCharCode('A'.charCodeAt(0) + choiceIndex);
}
function truncate(s, maxChars) {
    if (s.length <= maxChars)
        return s;
    return `${s.slice(0, maxChars)}\n...[truncated]`;
}
function writeModelSection(doc, resp, options) {
    const label = options[resp.choice] ? choiceToLetter(resp.choice) : '?';
    const optText = options[resp.choice] ?? '';
    doc.fontSize(11).text(`${resp.modelId} chose ${label}. ${optText}`);
    if (resp.reasoning) {
        doc.font('Helvetica').fontSize(9.5).fillColor('#111827').text(`Reasoning: ${truncate(resp.reasoning, 400)}`);
        doc.fillColor('#000000');
    }
    const tokenLineParts = [];
    if (resp.usageTokens?.inputTokens != null) {
        tokenLineParts.push(`inputTokens=${resp.usageTokens.inputTokens}`);
    }
    if (resp.usageTokens?.outputTokens != null) {
        tokenLineParts.push(`outputTokens=${resp.usageTokens.outputTokens}`);
    }
    if (tokenLineParts.length > 0) {
        doc.font('Helvetica').fontSize(9).text(tokenLineParts.join(', '));
    }
    if (resp.estimatedCostUsd != null) {
        doc.font('Helvetica').fontSize(9).text(`estimatedCostUsd≈$${resp.estimatedCostUsd.toFixed(6)}`);
    }
    if (resp.promptText) {
        doc.moveDown(0.2);
        doc.font('Courier').fontSize(8).text('Prompt sent to model (audit):');
        doc.font('Courier').fontSize(8).text(truncate(resp.promptText, 8000));
    }
    if (resp.rawText) {
        doc.moveDown(0.2);
        doc.font('Courier').fontSize(8).text('Raw model output:');
        doc.font('Courier').fontSize(8).text(truncate(resp.rawText, 8000));
    }
}
function streamDebatePdf(debate, res) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="debate-report-${debate.sessionId}.pdf"`);
    const doc = new pdfkit_1.default({ margin: 40, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(18).text('Multi-LLM Deliberation Report');
    doc.moveDown(0.5);
    doc.fontSize(10.5).text(`Session ID: ${debate.sessionId}`);
    doc.fontSize(10.5).text(`Models: ${debate.models.join(', ')}`);
    doc.fontSize(10.5).text(`Max rounds: ${debate.maxRounds}`);
    doc.fontSize(10.5).text(`Final: ${choiceToLetter(debate.finalChoice)}. ${debate.options[debate.finalChoice] ?? ''}`);
    doc.fontSize(10.5).text(`Consensus: ${debate.consensus ? 'YES' : 'NO'}`);
    if (debate.totalEstimatedCostUsd != null) {
        doc.fontSize(10.5).text(`Estimated total cost: $${debate.totalEstimatedCostUsd.toFixed(6)}`);
    }
    doc.moveDown();
    doc.fontSize(12).text('Question');
    doc.fontSize(10.5).font('Helvetica').text(debate.question);
    doc.moveDown(0.5);
    doc.fontSize(12).text('Options');
    doc.fontSize(10.5).font('Helvetica');
    debate.options.forEach((opt, idx) => {
        const letter = choiceToLetter(idx);
        doc.text(`${letter}. ${opt}`);
    });
    doc.moveDown();
    doc.fontSize(12).text('Deliberation transcript');
    for (const round of debate.rounds) {
        doc.moveDown(0.3);
        doc.fontSize(13).text(`Round ${round.round}`);
        if (round.consensusChoice != null) {
            doc.fontSize(10.5).text(`Round consensus: ${choiceToLetter(round.consensusChoice)}`);
        }
        doc.moveDown(0.2);
        // Keep order stable.
        const resps = [...round.responses].sort((a, b) => a.modelId.localeCompare(b.modelId));
        for (const resp of resps) {
            doc.moveDown(0.2);
            writeModelSection(doc, resp, debate.options);
            doc.moveDown(0.6);
            doc.lineWidth(0.2).strokeColor('#6b7280');
            doc.moveTo(doc.x, doc.y).lineTo(doc.x + 520, doc.y).stroke();
            doc.moveDown(0.2);
        }
    }
    doc.end();
}
