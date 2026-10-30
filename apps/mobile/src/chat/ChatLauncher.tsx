import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme';
import { Button, ErrorText } from '../ui';
import { useChat, type ChatMessage } from './useChat';

type Subscribe = (fn: (event: string, data: unknown) => void) => () => void;

export const DRIVER_QUICK_REPLIES = [
  'Estou a caminho',
  'Estou chegando',
  'Cheguei ao local',
  'Onde você está?',
];
export const CLIENT_QUICK_REPLIES = [
  'Já estou te esperando',
  'Estou chegando aí',
  'Pode esperar um minutinho?',
  'Qual é o seu veículo?',
];

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Botão "Chat" (com o número de mensagens novas) que abre a conversa do pedido. Serve ao motorista e ao
 * cliente: os dois podem começar a conversa. `open` = ainda dá para escrever (durante o atendimento).
 */
export function ChatLauncher({
  deliveryId,
  subscribe,
  realtimeOpen,
  open,
  who,
  quickReplies,
  size = 'md',
}: {
  deliveryId: string;
  subscribe: Subscribe;
  realtimeOpen: boolean;
  open: boolean;
  /** Com quem se fala: "o motorista", "o passageiro", "o cliente". */
  who: string;
  quickReplies: readonly string[];
  size?: 'md' | 'sm';
}) {
  const chat = useChat(deliveryId, subscribe, realtimeOpen);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const list = useRef<FlatList<ChatMessage>>(null);

  // Enquanto a conversa está aberta, o que chega já conta como lido.
  useEffect(() => {
    if (visible) chat.markRead();
  }, [visible, chat.markRead]);

  const submit = async (body: string) => {
    if (await chat.send(body)) setText('');
  };

  return (
    <>
      <Button
        title={chat.unread > 0 ? `💬 Chat (${chat.unread})` : '💬 Chat'}
        kind="ghost"
        size={size}
        onPress={() => setVisible(true)}
      />
      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <KeyboardAvoidingView
          style={s.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.header}>
            <Text style={s.title}>Conversa com {who}</Text>
            <Pressable
              onPress={() => setVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Fechar conversa"
              hitSlop={12}
            >
              <Text style={s.close}>Fechar</Text>
            </Pressable>
          </View>
          <FlatList
            ref={list}
            style={{ flex: 1 }}
            contentContainerStyle={s.messages}
            data={chat.messages}
            keyExtractor={(m) => m.id}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <Text style={s.empty}>
                {open ? `Diga olá para ${who}.` : 'Nenhuma mensagem nesta corrida.'}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={[s.bubble, item.fromMe ? s.mine : s.theirs]}>
                <Text style={[s.body, item.fromMe && { color: colors.white }]}>{item.body}</Text>
                <Text style={[s.time, item.fromMe && { color: colors.white }]}>
                  {time(item.createdAt)}
                </Text>
              </View>
            )}
          />
          <ErrorText message={chat.error} />
          {open ? (
            <View style={s.composer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.quick}
              >
                {quickReplies.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => void submit(q)}
                    disabled={chat.sending}
                    accessibilityRole="button"
                    accessibilityLabel={q}
                    style={s.chip}
                  >
                    <Text style={s.chipText}>{q}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  value={text}
                  onChangeText={setText}
                  placeholder="Escreva uma mensagem"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Mensagem"
                  maxLength={500}
                  multiline
                />
                <View style={{ width: 90 }}>
                  <Button
                    title="Enviar"
                    onPress={() => void submit(text)}
                    loading={chat.sending}
                    disabled={!text.trim()}
                  />
                </View>
              </View>
            </View>
          ) : (
            <Text style={s.closed}>A conversa foi encerrada junto com a corrida.</Text>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  title: { color: colors.black, fontSize: 17, fontWeight: '800', flex: 1 },
  close: { color: colors.red, fontWeight: '700', fontSize: 15 },
  messages: { padding: 14, gap: 8, flexGrow: 1 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
  bubble: { maxWidth: '80%', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.red },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: { color: colors.black, fontSize: 15 },
  time: { color: colors.muted, fontSize: 10, alignSelf: 'flex-end' },
  composer: {
    padding: 10,
    gap: 8,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  quick: { gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipText: { color: colors.red, fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.black,
  },
  closed: { color: colors.muted, textAlign: 'center', padding: 14 },
});
