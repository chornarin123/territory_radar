import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
  type ViewInstance,
} from 'react-native';
import { Bot, Send } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Txt } from '../components/ui';
import { useKeyboardOverlap } from '../components/useKeyboardOverlap';
import { useCoach, type ChatMessage } from '../data/CoachContext';
import { productShortName } from '../data/labels';
import { useLoadedWorkspace } from '../data/WorkspaceProvider';
import type { RootScreenProps } from '../navigation/types';
import { color, font, type } from '../theme/tokens';

const FOLLOW_UPS = [
  'What if they say it is already funded?',
  'How do I open this conversation naturally?',
  'What should I avoid saying?',
];

function sourceLabel(m: ChatMessage): string {
  if (m.source === 'offline') return 'Offline coach · built from this prospect’s data';
  const brand = m.source === 'claude' ? 'Claude' : 'Gemini';
  return m.model ? `${brand} · ${m.model}` : brand;
}

export function CoachScreen({ route, navigation }: RootScreenProps<'Coach'>) {
  const { ws, views } = useLoadedWorkspace();
  const coach = useCoach();
  const { id, question } = route.params;
  const { messages, sending, error } = coach.chat(id);
  const [draft, setDraft] = useState('');
  const scroller = useRef<ScrollViewInstance>(null);
  const screen = useRef<ViewInstance>(null);
  const keyboard = useKeyboardOverlap(screen);
  const insets = useSafeAreaInsets();

  const v = views.find((x) => x.id === id);
  const match = ws.productMatches.find((m) => m.prospectId === id && m.rank === 1);

  // A question tapped on the prospect screen arrives as a param: send it once,
  // then clear the param so coming back to this screen doesn't send it again.
  const sentParam = useRef<string | null>(null);
  useEffect(() => {
    if (!question || sentParam.current === question) return;
    sentParam.current = question;
    navigation.setParams({ question: undefined });
    void coach.send(id, question);
  }, [question, id, coach, navigation]);

  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [messages.length, sending, keyboard]);

  // Suggested questions not asked yet, then general follow-ups.
  const suggestions = useMemo(() => {
    const asked = new Set(messages.filter((m) => m.role === 'user').map((m) => m.content));
    return [...(match?.discoveryQuestions ?? []), ...FOLLOW_UPS]
      .filter((q) => !asked.has(q))
      .slice(0, 5);
  }, [messages, match]);

  if (!v) {
    return (
      <View style={[s.screen, { padding: 16 }]}>
        <Card>
          <Txt style={type.cardTitle}>Prospect not available</Txt>
          <Txt style={type.bodySm}>It is not in your territory, or it no longer exists.</Txt>
        </Card>
      </View>
    );
  }

  const submit = async (text: string) => {
    setDraft('');
    const r = await coach.send(id, text);
    // Refused (e.g. looked like customer details): give the text back to edit.
    if (!r.ok) setDraft(r.text);
  };

  return (
    // Lifted by exactly the part the keyboard covers, so the composer stays visible;
    // otherwise clear of the home indicator / Android nav bar (edge-to-edge).
    <View ref={screen} style={[s.screen, { paddingBottom: keyboard || insets.bottom }]}>
      <View style={s.context}>
        <View style={s.botIcon}>
          <Bot size={18} color={color.surface} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.contextName} numberOfLines={1}>
            {v.name}
          </Txt>
          <Txt style={type.caption} numberOfLines={1}>
            {v.product ? `${productShortName(v.product.name)} · ` : ''}Coaching only · not an
            eligibility decision
          </Txt>
        </View>
      </View>

      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={s.thread}>
        {messages.length === 0 && !sending ? (
          <View style={s.intro}>
            <Txt style={type.cardTitle}>Prepare for this conversation</Txt>
            <Txt style={type.bodySm}>
              Ask how to raise a topic, what an answer could mean, or what to check next. The coach
              knows this prospect&apos;s signals and suggested discussion — and that none of it is
              verified yet.
            </Txt>
          </View>
        ) : null}

        {messages.map((m) =>
          m.role === 'user' ? (
            <View key={m.id} style={s.userRow}>
              <View style={s.userBubble}>
                <Txt style={s.userText}>{m.content}</Txt>
              </View>
            </View>
          ) : (
            <View key={m.id} style={s.botRow}>
              <View style={s.botBubble}>
                <Txt style={s.botText}>{m.content}</Txt>
              </View>
              <Txt style={s.meta}>{sourceLabel(m)}</Txt>
              {m.notice ? <Txt style={s.notice}>{m.notice}</Txt> : null}
            </View>
          ),
        )}

        {sending ? (
          <View style={s.botRow}>
            <View style={[s.botBubble, s.typing]}>
              <ActivityIndicator size="small" color={color.navy} />
              <Txt style={[type.caption, { color: color.text2 }]}>Coach is thinking…</Txt>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {!sending && suggestions.length ? (
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
              onPress={() => void submit(q)}
              accessibilityRole="button"
              style={({ pressed }) => [s.suggestion, pressed && { opacity: 0.75 }]}
            >
              <Txt style={s.suggestionText}>{q}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={s.composer}>
        <View style={s.inputRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask the coach…"
            placeholderTextColor={color.text3}
            multiline
            maxLength={2000}
            style={s.input}
            accessibilityLabel="Message to the coach"
            onSubmitEditing={() => void submit(draft)}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => void submit(draft)}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[s.send, (!draft.trim() || sending) && s.sendOff]}
          >
            <Send size={18} color={color.surface} strokeWidth={2} />
          </Pressable>
        </View>
        {error ? (
          <Txt style={s.error}>{error}</Txt>
        ) : (
          <Txt style={s.hint}>Don&apos;t type customer names, phone, ID or account details.</Txt>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  botIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextName: { fontFamily: font.semibold, fontSize: 15, color: color.text },
  thread: { padding: 16, gap: 12, flexGrow: 1 },
  intro: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
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
  botRow: { alignItems: 'flex-start', gap: 4 },
  botBubble: {
    maxWidth: '92%',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  botText: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: color.text },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { fontFamily: font.regular, fontSize: 11, color: color.text3, paddingLeft: 4 },
  notice: { fontFamily: font.regular, fontSize: 11, color: color.pendText, paddingLeft: 4 },
  suggestBar: {
    flexGrow: 0,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  suggestions: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  suggestion: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  suggestionText: { fontFamily: font.semibold, fontSize: 12, color: color.navy },
  composer: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.text,
    backgroundColor: color.surface,
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
  hint: { fontFamily: font.regular, fontSize: 11, color: color.text3 },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.overdue },
});
