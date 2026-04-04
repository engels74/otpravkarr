<script lang="ts">
interface Props {
  form?: {
    error?: string;
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many login attempts. Please wait and try again.",
  missing_credentials: "Username and password are required.",
  invalid_credentials: "Invalid username or password.",
};

let { form }: Props = $props();
let errorMessage = $derived(
  form?.error ? (ERROR_MESSAGES[form.error] ?? "Unable to sign in.") : null,
);
</script>

<section class="mx-auto max-w-md space-y-4 p-6">
  <h1 class="text-2xl font-semibold">Admin Login</h1>
  <p class="text-sm opacity-80">Sign in to return to the dashboard.</p>

  {#if errorMessage}
    <p class="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">{errorMessage}</p>
  {/if}

  <form method="POST" class="space-y-3 rounded border p-4">
    <label class="block space-y-1">
      <span class="text-sm font-medium">Username</span>
      <input
        class="w-full rounded border px-3 py-2"
        name="username"
        type="text"
        autocomplete="username"
        required
      />
    </label>

    <label class="block space-y-1">
      <span class="text-sm font-medium">Password</span>
      <input
        class="w-full rounded border px-3 py-2"
        name="password"
        type="password"
        autocomplete="current-password"
        required
      />
    </label>

    <button class="rounded border px-4 py-2 text-sm font-medium" type="submit">Sign In</button>
  </form>
</section>
