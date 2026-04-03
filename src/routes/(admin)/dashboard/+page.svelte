<script lang="ts">
interface Props {
  data: {
    username: string;
  };
}

let { data }: Props = $props();
</script>

<section class="space-y-2 p-6">
  <h1 class="text-2xl font-semibold">Admin Dashboard</h1>
  <p class="text-sm opacity-80">Signed in as {data.username}.</p>
</section>
