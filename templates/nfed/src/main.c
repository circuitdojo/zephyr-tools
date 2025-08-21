/*
 * Copyright (c) 2016 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/led.h>
#include <zephyr/logging/log.h>
LOG_MODULE_REGISTER(main);

/* 1000 msec = 1 sec */
#define SLEEP_TIME_MS 1000

#if defined(CONFIG_BOARD_CIRCUITDOJO_FEATHER_NRF9151)

static const struct device *leds = DEVICE_DT_GET(DT_NODELABEL(npm1300_leds));

int main(void)
{
	LOG_INF("Blinky Sample");

	while (1)
	{
		led_on(leds, 2U);
		k_sleep(K_MSEC(SLEEP_TIME_MS));
		led_off(leds, 2U);
		k_sleep(K_MSEC(SLEEP_TIME_MS));
	}

	return 0;
}

#else

/* The devicetree node identifier for the "led0" alias. */
#define LED0_NODE DT_ALIAS(led0)

/*
 * A build error on this line means your board is unsupported.
 * See the sample documentation for information on how to fix this.
 */
static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(LED0_NODE, gpios);

void main(void)
{
	int ret;

	printk("Hello World! %s\n", CONFIG_BOARD);

	if (!gpio_is_ready_dt(&led))
	{
		return;
	}

	ret = gpio_pin_configure_dt(&led, GPIO_OUTPUT_ACTIVE);
	if (ret < 0)
	{
		return;
	}

	while (1)
	{
		ret = gpio_pin_toggle_dt(&led);
		if (ret < 0)
		{
			return;
		}
		k_msleep(SLEEP_TIME_MS);
	}
}

#endif