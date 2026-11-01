import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
  type ViewInstance,
} from 'react-native';
import { Send, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '../../api/client';
import { Txt } from '../../components/ui';
import { useKeyboardOverlap } from '../../components/useKeyboardOverlap';
import { LOAN_LABEL } from '../../data/areaDemand';
import {
  COMPARE_OFFSET,
  useChat,
  type AskReply,
  type EvidencePack,
  type RadarAction,
} from '../../data/evidence';
import { color, font } from '../../theme/tokens';

const C = {
  aiBg: '#f1f4f8',
  ok: '#15803d',
  okBg: '#e5f2e8',
  chipBorder: '#d5dbe4',
  label: '#5b6576',
};

/** Up to this many earlier turns go with each question (the server trims to 6). */
const HISTORY = 6;

/** "[2] Household density": a citation chip's text. */
function citationLabel(n: number, pack: EvidencePack, reply: AskReply): string {
  if (n >= COMPARE_OFFSET && reply.compared) return `[${n}] ${reply.compared.name}`;
  const title = pack.breakdown.find((i) => i.n === n)?.title ?? 'Evidence';
  return `[${n}] ${title.length > 24 ? `${title.slice(0, 23)}…` : title}`;
}

/** Ask Radar: questions about one sangkat, answered only from its evidence. */
export function AskRadarSheet({
  visible,
  onClose,
  pack,
  neighbour,
  onCite,
  onOpenArea,
  onAction,
}: {
  visible: boolean;
  onClose: () => void;
  pack: EvidencePack;
  /** Best-scoring other sangkat in the khan, for the "Compare with" suggestion. */
  neighbour: string | null;
  onCite: (n: number) => void;
  onOpenArea: (code: string) => void;
  onAction: (a: RadarAction) => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const label = LOAN_LABEL[pack.loanType];
  const [turns, setTurns] = useChat(pack.communeCode, pack.loanType);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<{ question: string; message: string } | null>(null);

  const sheet = useRef<ViewInstance>(null);
  const keyboard = useKeyboardOverlap(sheet);
  const scroller = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
  }, [turns.length, sending, failed, keyboard]);

  const asked = new Set(turns.filter((t) => t.role === 'user').map((t) => t.content));
  const suggestions = [
    `Why is ${label.toLowerCase()} demand high here?`,
    'Who should I visit first?',
    neighbour ? `Compare with ${neighbour}` : null,
    'What changed since last scan?',
  ].filter((q): q is string => !!q && !asked.has(q));

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || sending) return;
    setDraft('');
    setFailed(null);
    const history = turns.slice(-HISTORY).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setSending(true);
    try {
      const reply = await api.askRadar(pack.communeCode, {
        loanType: pack.loanType,
        question: q,
        history,
      });
      setTurns((t) => [...t, { role: 'assistant', content: reply.answer, reply }]);
    } catch (e) {
      // The question stays in the chat; retry resends it.
      setTurns((t) => t.slice(0, -1));
      setFailed({
        question: q,
        message:
          e instanceof ApiError && (e.status === 422 || e.status === 429)
            ? e.message
            : "Couldn't reach Radar. Try again.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close Ask Radar" />
        <View
          ref={sheet}
          role="dialog"
          aria-label="Ask Radar"
          style={[s.sheet, { height: height * 0.9, paddingBottom: keyboard || insets.bottom }]}
        >
          <View style={s.head}>
            <Txt style={s.title}>Ask Radar</Txt>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              aria-label="Close"
              style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <X size={22} color={color.navy} />
            </Pressable>
          </View>
          <View style={s.context}>
            <View style={s.ctxChip}>
              <Txt style={s.ctxText}>{pack.name}</Txt>
            </View>
            <View style={s.ctxChip}>
              <Txt style={s.ctxText}>{label}</Txt>
            </View>
            <View style={[s.ctxChip, s.ctxSafe]}>
              <Txt style={[s.ctxText, { color: C.ok }]}>Public data only · no customer records</Txt>
            </View>
          </View>

          <ScrollView
            ref={scroller}
            style={{ flex: 1 }}
            contentContainerStyle={s.thread}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.aiBubble}>
              <Txt style={s.aiText}>
                Ask anything about {label.toLowerCase()} in {pack.name}. I answer only from the
                evidence on this screen and cite it like [1].
              </Txt>
            </View>

            {turns.map((t, i) =>
              t.role === 'user' ? (
                <View key={i} style={s.userRow}>
                  <View style={s.userBubble}>
                    <Txt style={s.userText}>{t.content}</Txt>
                  </View>
                </View>
              ) : (
                <View key={i} style={{ gap: 6 }}>
                  <View style={s.aiBubble}>
                    <Txt style={s.aiText}>{t.content}</Txt>
                  </View>
                  {t.reply?.citations.length ? (
                    <View style={s.cites}>
                      {t.reply.citations.map((n) => {
                        const text = citationLabel(n, pack, t.reply!);
                        return (
                          <Pressable
                            key={n}
                            onPress={() =>
                              n >= COMPARE_OFFSET && t.reply!.compared
                                ? onOpenArea(t.reply!.compared.communeCode)
                                : onCite(n)
                            }
                            accessibilityRole="button"
                            aria-label={`Open evidence ${n}: ${text.replace(/^\[\d+\] /, '')}`}
                            style={({ pressed }) => [s.cite, pressed && { opacity: 0.7 }]}
                          >
                            <Txt style={s.citeText}>{text}</Txt>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {t.reply?.action ? (
                    <Pressable
                      onPress={() => onAction(t.reply!.action!)}
                      accessibilityRole="button"
                      style={({ pressed }) => [s.action, pressed && { opacity: 0.8 }]}
                    >
                      <Txt style={s.actionText}>{t.reply.action.label} →</Txt>
                    </Pressable>
                  ) : null}
                  {t.reply?.notice ? <Txt style={s.notice}>{t.reply.notice}</Txt> : null}
                </View>
              ),
            )}

            {sending ? (
              <View style={[s.aiBubble, s.typing]}>
                <ActivityIndicator size="small" color={color.navy} />
                <Txt style={s.notice}>Radar is checking the evidence…</Txt>
              </View>
            ) : null}
            {failed ? (
              <View style={s.failed}>
                <Txt style={s.failedText}>{failed.message}</Txt>
                <Pressable
                  onPress={() => void ask(failed.question)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.retry, pressed && { opacity: 0.7 }]}
                >
                  <Txt style={s.retryText}>Retry</Txt>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>

          {suggestions.length && !sending ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.suggestBar}
              contentContainerStyle={s.suggestions}
              keyboardShouldPersistTaps="handled"
            >
              {suggestions.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => void ask(q)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.suggestion, pressed && { opacity: 0.7 }]}
                >
                  <Txt style={s.suggestionText}>{q}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={s.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={`Ask about ${pack.name}…`}
              placeholderTextColor={C.label}
              multiline
              maxLength={500}
              style={s.input}
              aria-label="Question for Radar"
            />
            <Pressable
              onPress={() => void ask(draft)}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              aria-label="Send"
              accessibilityState={{ disabled: !draft.trim() || sending }}
              style={[s.send, (!draft.trim() || sending) && s.sendOff]}
            >
              <Send size={18} color={color.surface} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,12,24,0.45)' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingTop: 6,
  },
  title: { flex: 1, fontFamily: font.bold, fontSize: 17, color: color.text },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  context: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  ctxChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.chipBorder,
  },
  ctxSafe: { borderColor: '#bbe3c6', backgroundColor: C.okBg },
  ctxText: { fontFamily: font.semibold, fontSize: 12, color: color.navy },
  thread: { padding: 16, gap: 12 },
  aiBubble: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: C.aiBg,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  aiText: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: color.text },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: color.navy,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  userText: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.surface },
  cites: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cite: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c7d3e6',
    backgroundColor: '#eef3fa',
  },
  citeText: { fontFamily: font.semibold, fontSize: 12, color: color.navy },
  action: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: color.navy,
  },
  actionText: { fontFamily: font.semibold, fontSize: 13, color: color.surface },
  notice: { fontFamily: font.regular, fontSize: 11, color: C.label },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failed: { gap: 8, alignItems: 'flex-start' },
  failedText: { fontFamily: font.semibold, fontSize: 13, color: color.overdue },
  retry: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.navy,
  },
  retryText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  suggestBar: { flexGrow: 0, borderTopWidth: 1, borderTopColor: color.divider },
  suggestions: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  suggestion: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.chipBorder,
  },
  suggestionText: { fontFamily: font.semibold, fontSize: 12, color: color.navy },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.text,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: color.borderStrong },
});
