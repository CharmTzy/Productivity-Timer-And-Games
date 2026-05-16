import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import ButtonSign from '../pages/ButtonSignUp.js';
import MoneyTrack from './MoneyTrack.js';
import { auth, db } from '../firebase';
import { colors, radius, shadow, spacing } from '../Global/theme';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

const MAX_GOALS = 3;
const COINS_REWARD = 10;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function refineGoalWithAI(userInput) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a productivity coach. Rewrite the user\'s goal idea as ONE clear, specific, and achievable daily goal in 10 words or fewer. Return only the goal text, nothing else.',
        },
        { role: 'user', content: userInput },
      ],
      max_tokens: 40,
      temperature: 0.7,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI error');
  return data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
}

export default function DailyGoals() {
  const [goals, setGoals] = useState([]);
  const [streak, setStreak] = useState(0);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [rewardedToday, setRewardedToday] = useState(false);
  const navigation = useNavigation();
  const user = auth.currentUser;
  const displayName = user?.email?.split('@')[0] || 'friend';

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = db.collection('users').doc(user.uid).onSnapshot((doc) => {
      const data = doc.data() || {};
      const today = todayStr();

      if (data.goalsDate === today && Array.isArray(data.goals)) {
        setGoals(data.goals);
      } else {
        setGoals([]);
      }

      setStreak(data.streak || 0);
      setRewardedToday(data.lastCompletedDate === today);
    });
    return unsub;
  }, [user?.uid]);

  const persistGoals = useCallback(
    (newGoals) => {
      if (!user?.uid) return;
      db.collection('users').doc(user.uid).set(
        { goals: newGoals, goalsDate: todayStr() },
        { merge: true }
      );
    },
    [user?.uid]
  );

  const addGoal = async () => {
    if (!input.trim() || goals.length >= MAX_GOALS) return;

    setLoading(true);
    let refined = input.trim();

    try {
      refined = await refineGoalWithAI(input.trim());
    } catch {
      // Fall back to raw input if AI fails
    } finally {
      setLoading(false);
    }

    const newGoal = { id: Date.now().toString(), text: refined, done: false };
    const newGoals = [...goals, newGoal];
    setGoals(newGoals);
    persistGoals(newGoals);
    setInput('');
  };

  const toggleGoal = async (id) => {
    const newGoals = goals.map((g) => (g.id === id ? { ...g, done: !g.done } : g));
    setGoals(newGoals);
    persistGoals(newGoals);

    const allDone = newGoals.length === MAX_GOALS && newGoals.every((g) => g.done);
    if (allDone && !rewardedToday && user?.uid) {
      const docRef = db.collection('users').doc(user.uid);
      const snap = await docRef.get();
      const data = snap.data() || {};
      const today = todayStr();

      if (data.lastCompletedDate !== today) {
        const newStreak =
          data.lastCompletedDate === yesterdayStr() ? (data.streak || 0) + 1 : 1;
        const newCoins = (data.coin || 0) + COINS_REWARD;

        docRef.set(
          { coin: newCoins, streak: newStreak, lastCompletedDate: today },
          { merge: true }
        );

        Alert.alert(
          'All goals done! 🎉',
          `You earned ${COINS_REWARD} coins!\nStreak: ${newStreak} day${newStreak !== 1 ? 's' : ''} 🔥`
        );
      }
    }
  };

  const deleteGoal = (id) => {
    const newGoals = goals.filter((g) => g.id !== id);
    setGoals(newGoals);
    persistGoals(newGoals);
  };

  const completedCount = goals.filter((g) => g.done).length;
  const allDone = goals.length === MAX_GOALS && completedCount === MAX_GOALS;

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        <View style={styles.topBar}>
          <MoneyTrack />
          <ButtonSign navigation={navigation} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{dateLabel}</Text>
          <Text style={styles.title}>Hi {displayName}, what's your focus today?</Text>
        </View>

        <View style={styles.streakCard}>
          <View style={styles.streakLeft}>
            <Icon name="fire" size={30} color={streak > 0 ? colors.warning : colors.textMuted} />
            <View>
              <Text style={styles.streakCount}>{streak}</Text>
              <Text style={styles.streakLabel}>day streak</Text>
            </View>
          </View>
          <View style={styles.streakRight}>
            <View style={styles.progressPills}>
              {Array.from({ length: MAX_GOALS }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pill,
                    i < goals.length && styles.pillSet,
                    i < completedCount && styles.pillDone,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.pillLabel}>
              {completedCount}/{MAX_GOALS} done
            </Text>
          </View>
        </View>

        {goals.map((goal) => (
          <View key={goal.id} style={[styles.goalCard, goal.done && styles.goalCardDone]}>
            <TouchableOpacity
              style={[styles.checkbox, goal.done && styles.checkboxDone]}
              onPress={() => toggleGoal(goal.id)}
              activeOpacity={0.7}>
              {goal.done && <Icon name="check" size={14} color="#fff" />}
            </TouchableOpacity>

            <Text style={[styles.goalText, goal.done && styles.goalTextDone]} numberOfLines={2}>
              {goal.text}
            </Text>

            {!goal.done && (
              <TouchableOpacity onPress={() => deleteGoal(goal.id)} style={styles.deleteBtn}>
                <Icon name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        {allDone && (
          <View style={styles.doneBanner}>
            <Icon name="party-popper" size={20} color={colors.success} />
            <Text style={styles.doneText}>
              {rewardedToday
                ? 'All goals completed! Great work today.'
                : `All goals completed! +${COINS_REWARD} coins earned`}
            </Text>
          </View>
        )}

        {goals.length < MAX_GOALS && (
          <View style={styles.inputCard}>
            <View style={styles.inputHeader}>
              <Icon name="plus-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.inputTitle}>
                Add goal {goals.length + 1} of {MAX_GOALS}
              </Text>
            </View>
            <Text style={styles.inputHint}>
              Type your goal idea — AI will refine it into something specific
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="e.g. exercise, finish report…"
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={addGoal}
                returnKeyType="done"
                editable={!loading}
              />
              <TouchableOpacity
                style={[styles.addBtn, (!input.trim() || loading) && styles.addBtnDisabled]}
                onPress={addGoal}
                disabled={!input.trim() || loading}
                activeOpacity={0.8}>
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="arrow-up" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {goals.length === MAX_GOALS && !allDone && (
          <View style={styles.hintCard}>
            <Icon name="star-outline" size={18} color={colors.primary} />
            <Text style={styles.hintText}>
              Complete all 3 goals to earn {COINS_REWARD} coins and extend your streak!
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 110,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  hero: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  streakLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  streakCount: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
  },
  streakLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  streakRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  progressPills: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    width: 28,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
  },
  pillSet: {
    backgroundColor: colors.border,
  },
  pillDone: {
    backgroundColor: colors.success,
  },
  pillLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  goalCardDone: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  goalText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  goalTextDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  deleteBtn: {
    padding: 4,
  },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F0FDF4',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  doneText: {
    flex: 1,
    color: colors.success,
    fontSize: 14,
    fontWeight: '700',
  },
  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  inputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  inputTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  inputHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    height: 46,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: colors.border,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#EFF6FF',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  hintText: {
    flex: 1,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
});
